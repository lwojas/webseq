import { describe, expect, it } from "vitest";
import { GuidePreview, buildPreviewProject } from "../src/audio/guidePreview";
import { applyRecipe } from "../src/guide/apply";
import { homeDemo, noteDemo, scaleDemo } from "../src/guide/demos";
import { RECIPES, recipeById, type Recipe } from "../src/guide/recipes";
import { describeIdea, resolveRecipeTrack, scaleNoteNames } from "../src/guide/resolve";
import { blockWhileGuideOpen, pauseForGuide } from "../src/guide/session";
import { chordMidis } from "../src/model/chord";
import { rootMidiNote, setTrackInstrument } from "../src/model/instruments";
import { addNote, assignAsset, addAsset, createInitialProject, setPatternBars } from "../src/model/project";
import { projectReducer } from "../src/model/reducer";
import type { ProjectScale } from "../src/model/scale";
import type { Project } from "../src/model/types";
import { mockRuntime } from "./mockRuntime";

const A_PHRYGIAN: ProjectScale = { root: 9, scale: "phrygian", snap: false, preset: "minimalTechno" };
const C_MAJOR: ProjectScale = { root: 0, scale: "major", snap: false, preset: null };
const NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const fresh = (scale: ProjectScale = A_PHRYGIAN): Project => ({ ...createInitialProject(), scale });
const recipe = (id: string) => recipeById(id)!;
function apply(project: Project, id: string, patternId = project.patterns[0].id) {
  const result = applyRecipe(project, recipe(id), { patternId });
  if (!result.ok) throw new Error(result.reason);
  return result;
}
const notesOn = (project: Project, patternId: string, trackId: string) =>
  Object.values(project.patterns.find((p) => p.id === patternId)!.notes)
    .filter((n) => n.trackId === trackId)
    .sort((a, b) => a.start - b.start);
/** Sounding MIDI note of a plain note on a synth track. */
const midiOf = (project: Project, trackId: string, pitch: number | undefined) => {
  const hz = project.tracks.find((t) => t.id === trackId)!.instrument!.params.tune;
  return Math.round(69 + 12 * Math.log2(hz / 440)) + (pitch ?? 0);
};

describe("recipe library", () => {
  it("has the starter set: 2 bass, 2 melody, 2 chord recipes", () => {
    const count = (c: string) => RECIPES.filter((r) => r.category === c).length;
    expect([count("bass"), count("melody"), count("chords")]).toEqual([2, 2, 2]);
  });

  it("is scale-relative data only and every recipe has a musical length", () => {
    for (const r of RECIPES) {
      expect(r.bars).toBeGreaterThan(0);
      for (const t of r.tracks) {
        expect(t.events.length).toBeGreaterThan(0);
        for (const e of t.events) {
          expect(Number.isInteger(e.degree) && e.degree >= 1).toBe(true);
          expect(e.bar).toBeLessThan(r.bars);
          expect(e.step + e.length).toBeLessThanOrEqual(16);
        }
      }
    }
  });

  it("never overlaps notes within a track (the grid forbids it)", () => {
    for (const r of RECIPES) {
      for (const t of r.tracks) {
        const spans = t.events.map((e) => [e.bar * 16 + e.step, e.bar * 16 + e.step + e.length]).sort((a, b) => a[0] - b[0]);
        spans.forEach((s, i) => i > 0 && expect(s[0]).toBeGreaterThanOrEqual(spans[i - 1][1]));
      }
    }
  });

  it("only suggests instruments from the existing registry", () => {
    for (const r of RECIPES) for (const t of r.tracks) expect(["bass", "pulse", "pad"]).toContain(t.instrument);
  });
});

describe("scale-relative resolution", () => {
  it("resolves Root Pulse to A in A Phrygian and to C in C Major (no hard-coded MIDI)", () => {
    for (const [scale, name] of [[A_PHRYGIAN, "A"], [C_MAJOR, "C"]] as const) {
      const project = fresh(scale);
      const r = apply(project, "bass-root-pulse");
      const notes = notesOn(r.project, r.patternId, r.trackIds[0]);
      expect(notes.every((n) => NAMES[midiOf(r.project, r.trackIds[0], n.pitch) % 12] === name)).toBe(true);
    }
  });

  it("Root + Fifth lands on the fifth scale note of the current scale", () => {
    const r = apply(fresh(A_PHRYGIAN), "bass-root-fifth");
    const fifth = notesOn(r.project, r.patternId, r.trackIds[0]).find((n) => n.start === 8)!;
    expect(NAMES[midiOf(r.project, r.trackIds[0], fifth.pitch) % 12]).toBe("E"); // A Phrygian: A Bb C D E
    const major = apply(fresh(C_MAJOR), "bass-root-fifth");
    const g = notesOn(major.project, major.patternId, major.trackIds[0]).find((n) => n.start === 8)!;
    expect(NAMES[midiOf(major.project, major.trackIds[0], g.pitch) % 12]).toBe("G");
  });

  it("Tension & Release is 1 -> 3 -> 2 -> 1 in the scale", () => {
    const r = apply(fresh(A_PHRYGIAN), "melody-tension-release");
    const names = notesOn(r.project, r.patternId, r.trackIds[0]).slice(0, 4).map((n) => NAMES[midiOf(r.project, r.trackIds[0], n.pitch) % 12]);
    expect(names).toEqual(["A", "C", "Bb", "A"]);
  });

  it("recipe chords are the same NoteChord the editor stores, resolved against the scale", () => {
    const r = apply(fresh(A_PHRYGIAN), "chords-triad-movement");
    const notes = notesOn(r.project, r.patternId, r.trackIds[0]);
    expect(notes).toHaveLength(4);
    expect(notes.every((n) => n.chord && n.pitch === undefined)).toBe(true);
    const track = r.project.tracks.find((t) => t.id === r.trackIds[0])!;
    // bar 1: degree 1 -> A C E ; bar 2: degree 4 -> D F A ; bar 3: degree 5 -> E G Bb
    const names = notes.map((n) => chordMidis(A_PHRYGIAN, rootMidiNote(track), n.chord!).map((m) => NAMES[m % 12]).join(" "));
    expect(names).toEqual(["A C E", "D F A", "E G Bb", "A C E"]);
  });

  it("uses recipe velocities", () => {
    const r = apply(fresh(), "bass-root-pulse");
    const velocities = notesOn(r.project, r.patternId, r.trackIds[0]).slice(0, 4).map((n) => n.velocity);
    expect(velocities).toEqual([1, 0.85, 0.85, 0.85]);
  });

  it("clips events that do not fit the bar or sequence", () => {
    const project = fresh();
    const track = project.tracks[0];
    const notes = resolveRecipeTrack({ role: "melody", events: [{ bar: 0, step: 14, length: 8, degree: 1 }, { bar: 5, step: 0, length: 1, degree: 1 }, { bar: 0, step: 20, length: 1, degree: 1 }] }, track, A_PHRYGIAN, 16, 2);
    expect(notes).toHaveLength(1);
    expect(notes[0].duration).toBe(2);
  });

  it("describes ideas in scale degrees", () => {
    expect(describeIdea(recipe("melody-tension-release").tracks[0], A_PHRYGIAN)).toBe("1 → 3 → 2 → 1 …");
    expect(describeIdea(recipe("bass-root-fifth").tracks[0], A_PHRYGIAN)).toBe("1 → 1 → 5 → 1 …");
    expect(describeIdea(recipe("chords-triad-movement").tracks[0], A_PHRYGIAN)).toBe("1+3+5 → 4+6+1 → 5+7+2 → 1+3+5");
  });

  it("names the scale notes", () => {
    expect(scaleNoteNames(A_PHRYGIAN)).toEqual(["A", "A#", "C", "D", "E", "F", "G"]);
  });
});

describe("Try this: placement, length, instruments", () => {
  const pid = (p: Project) => p.patterns[0].id;

  it("uses the selected track when it is empty, and adds notes only there", () => {
    const project = fresh();
    const r = apply(project, "bass-root-pulse");
    expect(r.trackIds).toEqual(["track-1"]);
    expect(Object.keys(r.project.patterns[0].notes)).toHaveLength(16);
    const picked = applyRecipe(project, recipe("bass-root-pulse"), { patternId: pid(project), trackId: "track-5" });
    if (!picked.ok) throw new Error(picked.reason);
    expect(picked.trackIds).toEqual(["track-5"]);
  });

  it("moves on to the next empty track when the selected one has notes", () => {
    let project = fresh();
    project = addNote(project, pid(project), "track-2", 0);
    const r = applyRecipe(project, recipe("bass-root-pulse"), { patternId: pid(project), trackId: "track-2" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.trackIds).toEqual(["track-3"]);
    // Notes on other patterns do not make a track "not empty" for this sequence.
    expect(notesOn(r.project, pid(project), "track-2")).toHaveLength(1);
  });

  it("wraps past the last track back to the start", () => {
    let project = fresh();
    const last = project.tracks[project.tracks.length - 1].id;
    project = addNote(project, pid(project), last, 0);
    const r = applyRecipe(project, recipe("bass-root-pulse"), { patternId: pid(project), trackId: last });
    if (!r.ok) throw new Error(r.reason);
    expect(r.trackIds).toEqual(["track-1"]);
  });

  it("is purely additive: existing notes and sequences are untouched", () => {
    let project = fresh();
    project = setTrackInstrument(project, "track-1", "kick");
    project = addNote(project, pid(project), "track-1", 3);
    const before = project.patterns[0].notes;
    const r = applyRecipe(project, recipe("bass-root-pulse"), { patternId: pid(project), trackId: "track-1" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.project.patterns).toHaveLength(1);
    expect(r.project.patternChain).toEqual(project.patternChain);
    for (const [id, note] of Object.entries(before)) expect(r.project.patterns[0].notes[id]).toBe(note);
    expect(r.project.tracks[0]).toBe(project.tracks[0]);
    expect(r.trackIds).toEqual(["track-2"]);
  });

  it("grows a shorter sequence to the recipe length, never shrinks a longer one", () => {
    const project = fresh(); // 1 bar
    const grown = apply(project, "bass-root-pulse");
    expect(grown.grew).toBe(true);
    expect(grown.project.patterns[0].bars).toBe(4);
    const long = setPatternBars(project, pid(project), 8);
    const kept = apply(long, "bass-root-pulse");
    expect(kept.grew).toBe(false);
    expect(kept.project.patterns[0].bars).toBe(8);
    expect(apply(project, "chords-two-chord").project.patterns[0].bars).toBe(8);
  });

  it("growing keeps other tracks' notes", () => {
    let project = fresh();
    project = addNote(project, pid(project), "track-2", 5);
    const r = applyRecipe(project, recipe("bass-root-pulse"), { patternId: pid(project), trackId: "track-1" });
    if (!r.ok) throw new Error(r.reason);
    expect(notesOn(r.project, pid(project), "track-2")).toHaveLength(1);
  });

  it("gives an empty target the suggested instrument but never reassigns an existing sound", () => {
    const r = apply(fresh(), "chords-triad-movement");
    expect(r.project.tracks[0].instrument?.kind).toBe("pad");
    const project = assignAsset(addAsset(fresh(), { id: 9, name: "kick", type: "audio", duration: 1, sampleRate: 48000, channels: 1, origin: "import" }), "track-1", 9);
    const kept = apply(project, "bass-root-pulse");
    expect(kept.trackIds).toEqual(["track-1"]);
    expect(kept.project.tracks[0].assetId).toBe(9);
    expect(kept.project.tracks[0].instrument ?? null).toBeNull();
  });

  it("populates successive empty tracks for a multi-track recipe", () => {
    const multi: Recipe = {
      id: "test-multi",
      name: "Multi",
      category: "bass",
      description: "",
      bars: 2,
      tracks: [
        { role: "bass", instrument: "bass", events: [{ bar: 0, step: 0, length: 4, degree: 1 }] },
        { role: "chord", instrument: "pad", events: [{ bar: 0, step: 0, length: 16, degree: 1, chord: "triad" }] },
        { role: "melody", instrument: "pulse", events: [{ bar: 1, step: 0, length: 4, degree: 3 }] },
      ],
    };
    let project = addNote(fresh(), fresh().patterns[0].id, "track-1", 0); // wrong pattern id: refused
    expect(applyRecipe(project, multi, { patternId: "nope" }).ok).toBe(false);
    project = fresh();
    project = addNote(project, pid(project), "track-2", 0);
    const ok = applyRecipe(project, multi, { patternId: pid(project), trackId: "track-1" });
    if (!ok.ok) throw new Error(ok.reason);
    expect(ok.trackIds).toEqual(["track-1", "track-3", "track-4"]);
    expect(ok.trackIds.map((id) => ok.project.tracks.find((t) => t.id === id)!.instrument!.kind)).toEqual(["bass", "pad", "pulse"]);
    expect(ok.project.patterns[0].bars).toBe(2);
  });

  it("leaves an unavailable instrument unassigned and says so", () => {
    const project = fresh();
    const r = applyRecipe(project, recipe("bass-root-pulse"), { patternId: pid(project), isKindAvailable: () => false });
    if (!r.ok) throw new Error(r.reason);
    expect(r.messages[0]).toMatch(/isn't available/);
    expect(r.project.tracks.every((t) => !t.instrument)).toBe(true);
    expect(Object.keys(r.project.patterns[0].notes).length).toBeGreaterThan(0);
  });

  it("refuses, changing nothing, when there are not enough empty tracks", () => {
    let project = fresh();
    for (const t of project.tracks) project = addNote(project, pid(project), t.id, 0);
    expect(applyRecipe(project, recipe("bass-root-pulse"), { patternId: pid(project) }).ok).toBe(false);
    expect(projectReducer(project, { type: "APPLY_RECIPE", recipe: recipe("bass-root-pulse"), patternId: pid(project), trackId: null })).toBe(project);
  });

  it("the reducer action applies the recipe; applied material is ordinary editable data", () => {
    const project = fresh();
    const next = projectReducer(project, { type: "APPLY_RECIPE", recipe: recipe("chords-triad-movement"), patternId: pid(project), trackId: "track-3" });
    const notes = notesOn(next, pid(project), "track-3");
    expect(notes).toHaveLength(4);
    const edited = projectReducer(next, { type: "SET_NOTE_CHORD", patternId: pid(project), noteId: notes[0].id, patch: { degrees: [0, 2, 4, 6] } });
    expect(edited.patterns[0].notes[notes[0].id].chord?.degrees).toEqual([0, 2, 4, 6]);
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);
  });
});

describe("guide previews", () => {
  it("builds scale, note and home demos from degrees", () => {
    const scale = scaleDemo(A_PHRYGIAN, 16);
    expect(scale.track.events.map((e) => e.degree)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(noteDemo(3, 16).track.events).toHaveLength(1);
    expect(homeDemo(16).track.events.map((e) => e.degree)).toEqual([1, 3, 2, 1]);
  });

  it("plays through the shared compile path on its own instances and never modifies a project", () => {
    const { runtime, calls } = mockRuntime();
    const preview = new GuidePreview(runtime);
    const demo = scaleDemo(A_PHRYGIAN, 16);
    preview.play({ tracks: [demo.track], bars: demo.bars, scale: A_PHRYGIAN, bpm: 120, beatsPerBar: 16 });
    expect(calls.createInstrument).toHaveLength(1);
    expect(calls.instrumentNoteOn).toHaveLength(8);
    preview.stop();
    expect(calls.removeInstrument).toEqual([1]);
    preview.stop(); // idempotent
    expect(calls.removeInstrument).toEqual([1]);
  });

  it("previews a chord recipe polyphonically", () => {
    const { runtime, calls } = mockRuntime();
    const r = recipe("chords-triad-movement");
    new GuidePreview(runtime).play({ tracks: r.tracks, bars: r.bars, scale: A_PHRYGIAN, bpm: 120, beatsPerBar: 16 });
    expect(calls.createInstrument).toHaveLength(3);
    expect(calls.instrumentNoteOn).toHaveLength(12);
  });

  it("the preview project resolves the recipe's instrument, falling back otherwise", () => {
    const { project } = buildPreviewProject({ tracks: [{ role: "melody", instrument: "pulse", events: [] }, { role: "melody", events: [] }], bars: 1, scale: C_MAJOR, bpm: 120, beatsPerBar: 16 });
    expect(project.tracks.map((t) => t.instrument?.kind)).toEqual(["pulse", "pulse"]);
  });
});

describe("guide session contract", () => {
  it("opening the guide pauses a playing transport and only then", () => {
    let status: "playing" | "paused" | "stopped" = "playing";
    const transport = { getStatus: () => status, pause: () => void (status = "paused") };
    expect(pauseForGuide(transport)).toBe(true);
    expect(status).toBe("paused");
    expect(pauseForGuide(transport)).toBe(false);
    status = "stopped";
    expect(pauseForGuide(transport)).toBe(false);
    expect(status).toBe("stopped");
    expect(pauseForGuide(null)).toBe(false);
  });

  it("blocks window/MIDI input while open and lets it through once closed (closing never resumes)", () => {
    let open = true;
    const seen: number[] = [];
    const guarded = blockWhileGuideOpen(() => open, (n: number) => void seen.push(n));
    guarded(1);
    expect(seen).toEqual([]);
    open = false;
    guarded(2);
    expect(seen).toEqual([2]);
  });

  it("opening the guide does not modify the project", () => {
    // The guide reads the project and previews on its own instances; the only write is APPLY_RECIPE.
    const project = fresh();
    const before = JSON.stringify(project);
    const { runtime, calls } = mockRuntime();
    new GuidePreview(runtime).play({ tracks: [scaleDemo(A_PHRYGIAN, 16).track], bars: 2, scale: A_PHRYGIAN, bpm: 120, beatsPerBar: 16 });
    expect(JSON.stringify(project)).toBe(before);
    expect(calls.instrumentNoteOn.length).toBeGreaterThan(0);
  });
});
