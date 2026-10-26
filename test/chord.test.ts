import { describe, expect, it } from "vitest";
import { syncBuses } from "../src/audio/busSync";
import { instrumentHostFor } from "../src/audio/instruments";
import { compileInstrumentNotes, compilePatternIteration } from "../src/audio/compile";
import {
  CHORD_SHAPES,
  chordMidis,
  chordPitchOffsets,
  chordVoicesNeeded,
  expandChordNotes,
  normalizeChord,
  setNoteChord,
  setNoteMode,
  type NoteChord,
} from "../src/model/chord";
import { rootMidiNote, setTrackInstrument } from "../src/model/instruments";
import { copyTrack, pasteTrack } from "../src/model/edit";
import { addAsset, addNote, assignAsset, createInitialProject, setNotePitch } from "../src/model/project";
import { projectReducer } from "../src/model/reducer";
import { createScale, patchScale, type ProjectScale } from "../src/model/scale";
import type { Project } from "../src/model/types";
import { mockRuntime } from "./mockRuntime";

const A_PHRYGIAN: ProjectScale = { root: 9, scale: "phrygian", snap: false, preset: null };
const C_MAJOR: ProjectScale = { root: 0, scale: "major", snap: false, preset: null };
const A_MINOR: ProjectScale = { root: 9, scale: "minor", snap: false, preset: null };
const triad = (root: number): NoteChord => ({ root, degrees: [0, 2, 4] });
const seventh = (root: number): NoteChord => ({ root, degrees: [0, 2, 4, 6] });
const NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const names = (midis: number[]) => midis.map((m) => NAMES[m % 12]);

// A synth track rooted at A1 (Bass: 55 Hz) and a sample track (offset 0 = the key's tonic, oct 4).
const bassTrack = (): number | null => rootMidiNote(setTrackInstrument(createInitialProject(), "track-1", "bass").tracks[0]);
const sampleTrack = (): number | null => null;

describe("scale-relative chord resolution", () => {
  it("builds an A Phrygian triad and seventh from the scale (A C E / A C E G)", () => {
    expect(names(chordMidis(A_PHRYGIAN, bassTrack(), triad(0)))).toEqual(["A", "C", "E"]);
    expect(names(chordMidis(A_PHRYGIAN, bassTrack(), seventh(0)))).toEqual(["A", "C", "E", "G"]);
    expect(chordMidis(A_PHRYGIAN, bassTrack(), triad(0))).toEqual([33, 36, 40]);
  });

  it("follows the chosen root: Bb gives Bb D F A", () => {
    expect(names(chordMidis(A_PHRYGIAN, bassTrack(), seventh(1)))).toEqual(["Bb", "D", "F", "A"]);
  });

  it("wraps scale degrees across octaves (9 is degree 2 an octave up; roots past the scale wrap)", () => {
    const ninth = chordMidis(A_PHRYGIAN, bassTrack(), { root: 0, degrees: [0, 2, 4, 6, 8] });
    expect(names(ninth)).toEqual(["A", "C", "E", "G", "Bb"]);
    expect(ninth[4]).toBe(33 + 12 + 1);
    // Root G (index 6): G, B-flat... stacking continues into the next octave: G Bb D (octave up).
    expect(names(chordMidis(A_PHRYGIAN, bassTrack(), triad(6)))).toEqual(["G", "Bb", "D"]);
    expect(chordMidis(A_PHRYGIAN, bassTrack(), triad(7))).toEqual(chordMidis(A_PHRYGIAN, bassTrack(), triad(0)).map((m) => m + 12));
    expect(names(chordMidis(A_PHRYGIAN, bassTrack(), triad(-1)))).toEqual(["G", "Bb", "D"]);
  });

  it("different project scales give different concrete notes for the same chord", () => {
    expect(chordMidis(C_MAJOR, sampleTrack(), triad(0))).toEqual([60, 64, 67]);
    expect(chordMidis(A_MINOR, sampleTrack(), triad(0))).toEqual([69, 72, 76]);
    expect(chordMidis(A_PHRYGIAN, sampleTrack(), triad(1))).toEqual([70, 74, 77]);
    // Major triad on degree 2 of C major is D minor (D F A).
    expect(names(chordMidis(C_MAJOR, sampleTrack(), triad(1)))).toEqual(["D", "F", "A"]);
  });

  it("falls back to Major on the key root in the (default) chromatic scale", () => {
    expect(chordMidis({ ...createScale(), root: 7 }, sampleTrack(), triad(0))).toEqual(chordMidis({ ...C_MAJOR, root: 7 }, sampleTrack(), triad(0)));
  });

  it("expresses tones as pitch offsets from the track's own pitch", () => {
    expect(chordPitchOffsets(A_PHRYGIAN, bassTrack(), triad(0))).toEqual([0, 3, 7]);
    expect(chordPitchOffsets(A_PHRYGIAN, sampleTrack(), triad(0))).toEqual([0, 3, 7]);
  });

  it("offers the documented shapes", () => {
    expect(CHORD_SHAPES.map((s) => s.degrees.length)).toEqual([3, 4, 5]);
  });
});

function withChord(scale: ProjectScale, kind: "bass" | null, chord: NoteChord, noteCount = 1) {
  let project: Project = createInitialProject();
  if (kind) project = setTrackInstrument(project, "track-1", kind);
  else project = assignAsset(addAsset(project, { id: 5, name: "s", type: "audio", duration: 1, sampleRate: 48000, channels: 1, origin: "import" }), "track-1", 5);
  project = { ...project, scale };
  const patternId = project.patterns[0].id;
  for (let i = 0; i < noteCount; i++) project = addNote(project, patternId, "track-1", i * 4);
  const pattern = project.patterns[0];
  const notes = Object.values(pattern.notes).map((n) => ({ ...n, chord }));
  project = { ...project, patterns: [{ ...pattern, notes: Object.fromEntries(notes.map((n) => [n.id, n])) }, ...project.patterns.slice(1)] };
  return project;
}

describe("chords reach the existing playback path as ordinary notes", () => {
  it("expands one stored chord note into N notes with the same start, length and velocity", () => {
    const project = withChord(A_PHRYGIAN, "bass", triad(0));
    const stored = Object.values(project.patterns[0].notes);
    expect(stored).toHaveLength(1);
    const played = expandChordNotes(project.tracks[0], stored, project.scale);
    expect(played.map((n) => n.pitch ?? 0)).toEqual([0, 3, 7]);
    expect(played.every((n) => n.start === stored[0].start && n.duration === stored[0].duration && n.velocity === stored[0].velocity)).toBe(true);
    expect(played.every((n) => !("chord" in n))).toBe(true);
  });

  it("compiles synth chords to one instrumentNoteOn per tone, on voices 0..2", () => {
    const project = withChord(A_PHRYGIAN, "bass", triad(0));
    const events = compileInstrumentNotes(project.patterns[0], project.tracks, 120, 10, 0.5, undefined, 16, project.scale);
    expect(events.map((e) => e.voice)).toEqual([0, 1, 2]);
    expect(events.map((e) => e.params.pitch ?? 0)).toEqual([0, 3, 7]);
    expect(new Set(events.map((e) => e.params.time)).size).toBe(1);
  });

  it("gives a chord track one engine instance per tone and routes tone i to instance i", () => {
    const project = withChord(A_PHRYGIAN, "bass", seventh(0));
    const { runtime, calls } = mockRuntime();
    syncBuses(runtime, project, Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`track-${i + 1}`, i + 1])));
    expect(calls.createInstrument).toHaveLength(4);
    const host = instrumentHostFor(runtime);
    for (const e of compileInstrumentNotes(project.patterns[0], project.tracks, 120, 0, 0.5, undefined, 16, project.scale)) host.noteOn(e.trackId, e.params, e.voice);
    expect(calls.instrumentNoteOn.map(([id]) => id)).toEqual([1, 2, 3, 4]);
    // Controls reach every instance, and stopAll silences them all.
    host.stopAll();
    expect(calls.instrumentNoteOff).toEqual([1, 2, 3, 4]);
  });

  it("a track without chords still uses exactly one instance", () => {
    const { runtime, calls } = mockRuntime();
    syncBuses(runtime, setTrackInstrument(createInitialProject(), "track-1", "bass"), { "track-1": 1 });
    expect(calls.createInstrument).toHaveLength(1);
  });

  it("shrinks the instance pool when the chords are removed", () => {
    const { runtime, calls } = mockRuntime();
    const buses = { "track-1": 1 };
    const project = withChord(A_PHRYGIAN, "bass", triad(0));
    syncBuses(runtime, project, buses);
    expect(calls.createInstrument).toHaveLength(3);
    const noChord = projectReducer(project, { type: "SET_NOTE_MODE", patternId: project.patterns[0].id, noteId: Object.keys(project.patterns[0].notes)[0], mode: "note" });
    syncBuses(runtime, noChord, buses);
    expect(calls.removeInstrument).toHaveLength(2);
  });

  it("compiles sample chords to simultaneous pitched voice events", () => {
    const project = withChord(C_MAJOR, null, triad(0));
    const events = compilePatternIteration(project.patterns[0], project.tracks, 120, 0, () => undefined, 0.5, undefined, 16, project.scale);
    expect(events.map((e) => e.pitch ?? 0)).toEqual([0, 4, 7]);
    expect(new Set(events.map((e) => e.time)).size).toBe(1);
    expect(events.every((e) => e.gain === 1)).toBe(true);
  });

  it("re-resolves when the project scale changes, without touching the stored chord", () => {
    const project = withChord(A_PHRYGIAN, "bass", triad(0));
    const stored = project.patterns[0].notes;
    const minor = projectReducer(project, { type: "SET_PROJECT_SCALE", patch: { scale: "minor" } });
    expect(minor.patterns[0].notes).toBe(stored);
    const a = compileInstrumentNotes(project.patterns[0], project.tracks, 120, 0, 0.5, undefined, 16, project.scale);
    const b = compileInstrumentNotes(minor.patterns[0], minor.tracks, 120, 0, 0.5, undefined, 16, minor.scale);
    expect(a.map((e) => e.params.pitch ?? 0)).toEqual([0, 3, 7]);
    expect(b.map((e) => e.params.pitch ?? 0)).toEqual([0, 3, 7]);
    const lydian = patchScale(minor.scale!, { scale: "lydian" });
    const c = compileInstrumentNotes(minor.patterns[0], minor.tracks, 120, 0, 0.5, undefined, 16, lydian);
    expect(c.map((e) => e.params.pitch ?? 0)).toEqual([0, 4, 7]); // A C# E
  });

  it("chords on a mono sample track are not silenced by the same-start truncation", () => {
    let project = withChord(C_MAJOR, null, triad(0));
    project = { ...project, tracks: project.tracks.map((t) => ({ ...t, voiceMode: "mono" as const })) };
    const events = compilePatternIteration(project.patterns[0], project.tracks, 120, 0, () => undefined, 0.5, undefined, 16, project.scale);
    expect(events.every((e) => (e.duration ?? 0) > 0)).toBe(true);
  });
});

describe("backwards compatibility with plain notes", () => {
  it("leaves a track with no chords untouched (same array, same pitches)", () => {
    let project = setTrackInstrument(createInitialProject(), "track-1", "bass");
    const patternId = project.patterns[0].id;
    project = addNote(project, patternId, "track-1", 0);
    const id = Object.keys(project.patterns[0].notes)[0];
    project = setNotePitch(project, patternId, id, 5);
    const notes = Object.values(project.patterns[0].notes);
    expect(expandChordNotes(project.tracks[0], notes, project.scale)).toBe(notes);
    const [e] = compileInstrumentNotes(project.patterns[0], project.tracks, 120, 0);
    expect(e.voice).toBe(0);
    expect(e.params.pitch).toBe(5);
  });

  it("a scale change never rewrites plain notes", () => {
    let project = createInitialProject();
    project = addNote(project, project.patterns[0].id, "track-1", 0);
    const before = project.patterns[0].notes;
    expect(projectReducer(project, { type: "SET_PROJECT_SCALE", patch: { root: 9, scale: "phrygian" } }).patterns[0].notes).toBe(before);
  });

  it("chordVoicesNeeded is empty without chords", () => {
    expect(chordVoicesNeeded(createInitialProject()).size).toBe(0);
  });
});

describe("Note <-> Chord mode and persistence", () => {
  function plain(pitch: number) {
    let project: Project = { ...setTrackInstrument(createInitialProject(), "track-1", "bass"), scale: A_PHRYGIAN };
    const patternId = project.patterns[0].id;
    project = addNote(project, patternId, "track-1", 0);
    const noteId = Object.keys(project.patterns[0].notes)[0];
    return { project: setNotePitch(project, patternId, noteId, pitch), patternId, noteId };
  }

  it("switching to Chord roots a triad on the note's pitch and drops the plain pitch", () => {
    const { project, patternId, noteId } = plain(3); // C2 in A Phrygian
    const chord = setNoteMode(project, patternId, noteId, "chord").patterns[0].notes[noteId];
    expect(chord.pitch).toBeUndefined();
    expect(chord.chord).toEqual({ root: 2, degrees: [0, 2, 4] });
    expect(names(chordMidis(A_PHRYGIAN, rootMidiNote(project.tracks[0]), chord.chord!))).toEqual(["C", "E", "G"]);
  });

  it("switching back to Note keeps the chord's root as the pitch", () => {
    const { project, patternId, noteId } = plain(3);
    const asChord = setNoteMode(project, patternId, noteId, "chord");
    const back = setNoteMode(asChord, patternId, noteId, "note").patterns[0].notes[noteId];
    expect(back.chord).toBeUndefined();
    expect(back.pitch).toBe(3);
  });

  it("edits root and degrees, normalising them", () => {
    const { project, patternId, noteId } = plain(0);
    let p = setNoteMode(project, patternId, noteId, "chord");
    p = setNoteChord(p, patternId, noteId, { degrees: [4, 0, 2, 2, 6, 8, 10, 12] });
    expect(p.patterns[0].notes[noteId].chord?.degrees).toEqual([0, 2, 4, 6, 8]);
    p = setNoteChord(p, patternId, noteId, { root: 3 });
    expect(p.patterns[0].notes[noteId].chord?.root).toBe(3);
    // Ignored on a plain note.
    expect(setNoteChord(project, patternId, noteId, { root: 3 })).toBe(project);
  });

  it("round-trips through JSON (save / recovery) unchanged", () => {
    const { project, patternId, noteId } = plain(3);
    const withChord = setNoteMode(project, patternId, noteId, "chord");
    expect(JSON.parse(JSON.stringify(withChord))).toEqual(withChord);
  });

  it("rejects malformed stored chords", () => {
    expect(normalizeChord(null)).toBeNull();
    expect(normalizeChord({ root: "x", degrees: [0] })).toBeNull();
    expect(normalizeChord({ root: 0, degrees: [] })).toBeNull();
    expect(normalizeChord({ root: 1.4, degrees: [0, 2, -1, NaN] })).toEqual({ root: 1, degrees: [0, 2] });
  });

  it("is carried by copy/paste", () => {
    const { project, patternId, noteId } = plain(3);
    const asChord = setNoteMode(project, patternId, noteId, "chord");
    const clip = copyTrack(asChord, "track-1", patternId)!;
    expect(clip.notes[0].chord).toEqual({ root: 2, degrees: [0, 2, 4] });
    const pasted = pasteTrack(asChord, "track-2", patternId, clip);
    expect(Object.values(pasted.patterns[0].notes).filter((n) => n.trackId === "track-2")[0].chord).toEqual({ root: 2, degrees: [0, 2, 4] });
  });
});

describe("malformed stored chords", () => {
  it("never throw in playback: a corrupt chord plays as a plain note", () => {
    const project = withChord(A_PHRYGIAN, "bass", { root: 0, degrees: "oops" } as unknown as NoteChord);
    expect(() => compileInstrumentNotes(project.patterns[0], project.tracks, 120, 0, 0.5, undefined, 16, project.scale)).not.toThrow();
    expect(chordVoicesNeeded(project).size).toBe(0);
  });
});

// --- chord types, inversions, voicings ---
import { CHORD_TYPES, arrangeTones, chordTypeId, chordTypePatch, maxInversion } from "../src/model/chord";

const C_MINOR: ProjectScale = { root: 0, scale: "minor", snap: false, preset: null };
const typed = (type: string, extra: Partial<NoteChord> = {}, root = 0): NoteChord => normalizeChord({ root, ...chordTypePatch(type)!, ...extra })!;
const midis = (c: NoteChord, scale = C_MAJOR) => chordMidis(scale, sampleTrack(), c); // C4 = 60

describe("chord types", () => {
  it("builds every named type from its intervals on C4", () => {
    const expected: Record<string, number[]> = {
      maj: [60, 64, 67], min: [60, 63, 67], dim: [60, 63, 66], aug: [60, 64, 68], sus2: [60, 62, 67], sus4: [60, 65, 67],
      "6": [60, 64, 67, 69], m6: [60, 63, 67, 69], "69": [60, 64, 67, 69, 74],
      maj7: [60, 64, 67, 71], m7: [60, 63, 67, 70], "7": [60, 64, 67, 70], dim7: [60, 63, 66, 69], m7b5: [60, 63, 66, 70],
      maj9: [60, 64, 67, 71, 74], m9: [60, 63, 67, 70, 74], "9": [60, 64, 67, 70, 74],
      "11": [60, 67, 70, 74, 77], m11: [60, 63, 70, 74, 77], "13": [60, 64, 70, 74, 81],
    };
    expect(CHORD_TYPES.map((t) => t.id).sort()).toEqual(Object.keys(expected).sort());
    for (const [id, notes] of Object.entries(expected)) expect(midis(typed(id)), id).toEqual(notes);
  });

  it("keeps a type's quality in any scale (the root follows the scale, the intervals do not)", () => {
    expect(midis(typed("m7"), C_MAJOR)).toEqual(midis(typed("m7"), C_MINOR));
    // Root degree 2 of C major is D: D minor 7 = D F A C.
    expect(names(midis(typed("m7", {}, 1)))).toEqual(["D", "F", "A", "C"]);
    // Same stored chord on a different scale's degree 2 (C Phrygian: Db).
    expect(names(midis(typed("m7", {}, 1), { ...C_MAJOR, scale: "phrygian" }))).toEqual(["Db", "E", "Ab", "B"]);
  });

  it("every named type fits the engine's voice budget", () => {
    for (const t of CHORD_TYPES) expect(t.intervals.length).toBeLessThanOrEqual(5);
  });

  it("legacy scale-derived shapes still follow the scale", () => {
    expect(midis(triad(0), C_MAJOR)).toEqual([60, 64, 67]);
    expect(midis(triad(0), C_MINOR)).toEqual([60, 63, 67]);
  });
});

describe("inversions", () => {
  it("rearranges Cm7 exactly as specified", () => {
    const m7 = (inversion: number) => midis(typed("m7", { inversion }));
    expect(m7(0)).toEqual([60, 63, 67, 70]);
    expect(m7(1)).toEqual([63, 67, 70, 72]);
    expect(m7(2)).toEqual([67, 70, 72, 75]);
    expect(m7(3)).toEqual([70, 72, 75, 79]);
  });

  it("offers one position per tone and clamps beyond that", () => {
    expect(maxInversion(typed("maj"))).toBe(2);
    expect(maxInversion(typed("m9"))).toBe(4);
    expect(typed("maj", { inversion: 7 }).inversion).toBe(2);
    expect(typed("maj", { inversion: -3 }).inversion).toBeUndefined();
    expect(arrangeTones([0, 4, 7], 12, 9)).toEqual(arrangeTones([0, 4, 7], 12, 2));
  });

  it("inverts compound chords (Cm9 1st inversion: Eb G Bb C D)", () => {
    expect(midis(typed("m9", { inversion: 1 }))).toEqual([63, 67, 70, 72, 74]);
  });

  it("inverts legacy scale chords by the scale's octave (pentatonic: 5 steps)", () => {
    expect(midis({ ...triad(0), inversion: 1 }, C_MAJOR)).toEqual([64, 67, 72]);
    const pent: ProjectScale = { ...C_MAJOR, scale: "minorPentatonic" };
    const plain = midis(triad(0), pent);
    expect(midis({ ...triad(0), inversion: 1 }, pent)).toEqual([plain[1], plain[2], plain[0] + 12]);
  });

  it("keeps the same pitch classes in every inversion", () => {
    for (const t of CHORD_TYPES) for (let i = 0; i <= maxInversion(typed(t.id)); i++) {
      const pcs = (c: NoteChord) => [...new Set(midis(c).map((m) => m % 12))].sort((a, b) => a - b);
      expect(pcs(typed(t.id, { inversion: i })), `${t.id} inv ${i}`).toEqual(pcs(typed(t.id)));
    }
  });
});

describe("voicing", () => {
  it("open lifts the second tone an octave (Cm7: C G Bb Eb)", () => {
    expect(midis(typed("m7", { voicing: "open" }))).toEqual([60, 67, 70, 75]);
    expect(midis(typed("min", { voicing: "open" }))).toEqual([60, 67, 75]);
  });

  it("close is the default and equals no voicing field", () => {
    expect(midis(typed("m7", { voicing: "close" }))).toEqual(midis(typed("m7")));
    expect(typed("m7", { voicing: "close" }).voicing).toBeUndefined();
  });

  it("combines with inversion (inversion first, then open)", () => {
    // Cm7 1st inversion Eb G Bb C -> lift G: Eb Bb C G.
    expect(midis(typed("m7", { inversion: 1, voicing: "open" }))).toEqual([63, 70, 72, 79]);
  });

  it("never loses or duplicates a tone", () => {
    for (const t of CHORD_TYPES) expect(midis(typed(t.id, { voicing: "open" })).length).toBe(t.intervals.length);
  });

  it("leaves one- and two-tone stacks alone", () => {
    expect(arrangeTones([0], 12, 0, "open")).toEqual([0]);
    expect(arrangeTones([0, 7], 12, 0, "open")).toEqual([0, 7]);
  });
});

describe("root, octave and range", () => {
  it("builds every type on each of the 12 chromatic roots with the same shape", () => {
    for (let root = 0; root < 12; root++) {
      const ctx: ProjectScale = { ...C_MAJOR, root };
      const m = chordMidis(ctx, sampleTrack(), typed("m7"));
      expect(m.map((x) => x - m[0])).toEqual([0, 3, 7, 10]);
      expect(m[0] % 12).toBe(root);
    }
  });

  it("wraps roots past the scale into the next octave", () => {
    expect(midis(typed("maj7", {}, 7))).toEqual(midis(typed("maj7")).map((m) => m + 12));
  });

  it("reaches the engine as clamped pitch offsets", () => {
    const high = chordPitchOffsets(C_MAJOR, sampleTrack(), typed("13", { inversion: 4, voicing: "open" }, 28));
    expect(Math.max(...high)).toBeLessThanOrEqual(48);
    expect(chordPitchOffsets(C_MAJOR, sampleTrack(), typed("maj"))).toEqual([0, 4, 7]);
  });

  it("is deterministic", () => {
    expect(midis(typed("m9", { inversion: 2, voicing: "open" }))).toEqual(midis(typed("m9", { inversion: 2, voicing: "open" })));
  });
});

describe("persistence and compatibility", () => {
  it("existing chords normalise to exactly their stored form (no new fields)", () => {
    expect(normalizeChord({ root: 2, degrees: [0, 2, 4] })).toEqual({ root: 2, degrees: [0, 2, 4] });
    expect(Object.keys(normalizeChord({ root: 2, degrees: [0, 2, 4] })!)).toEqual(["root", "degrees"]);
  });

  it("round-trips new fields through JSON and drops unknown ones", () => {
    const c = typed("m9", { inversion: 2, voicing: "open" }, 3);
    expect(normalizeChord(JSON.parse(JSON.stringify(c)))).toEqual(c);
    const odd = normalizeChord({ root: 0, degrees: [0, 2, 4], type: "nope", inversion: 9, voicing: "wide" })!;
    expect(odd).toEqual({ root: 0, degrees: [0, 2, 4], inversion: 2 });
  });

  it("names the type the menu shows", () => {
    expect(chordTypeId(typed("m7"))).toBe("m7");
    expect(chordTypeId(triad(0))).toBe("triad");
    expect(chordTypeId({ root: 0, degrees: [0, 1] })).toBeNull();
  });

  it("edits type, inversion and voicing through the reducer and re-clamps on a smaller type", () => {
    let project: Project = withChord(C_MAJOR, "bass", triad(0));
    const patternId = project.patterns[0].id;
    const noteId = Object.keys(project.patterns[0].notes)[0];
    const get = () => project.patterns[0].notes[noteId].chord!;
    project = projectReducer(project, { type: "SET_NOTE_CHORD", patternId, noteId, patch: chordTypePatch("m9")! });
    project = projectReducer(project, { type: "SET_NOTE_CHORD", patternId, noteId, patch: { inversion: 4, voicing: "open" } });
    expect(get()).toMatchObject({ type: "m9", inversion: 4, voicing: "open" });
    project = projectReducer(project, { type: "SET_NOTE_CHORD", patternId, noteId, patch: chordTypePatch("sus4")! });
    expect(get().inversion).toBe(2);
    project = projectReducer(project, { type: "SET_NOTE_CHORD", patternId, noteId, patch: chordTypePatch("triad")! });
    expect(get().type).toBeUndefined();
  });

  it("plays an inverted, typed chord one engine instance per tone, and counts its tones", () => {
    const project = withChord(C_MAJOR, "bass", typed("m9", { inversion: 1, voicing: "open" }));
    expect(chordVoicesNeeded(project).get("track-1")).toBe(5);
    const events = compileInstrumentNotes(project.patterns[0], project.tracks, 120, 0, 0.5, undefined, 16, project.scale);
    expect(events.map((e) => e.voice)).toEqual([0, 1, 2, 3, 4]);
    const offsets = events.map((e) => e.params.pitch ?? 0);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it("copy/paste carries the new fields", () => {
    const project = withChord(C_MAJOR, "bass", typed("sus4", { inversion: 1, voicing: "open" }));
    const clip = copyTrack(project, "track-1", project.patterns[0].id)!;
    expect(clip.notes[0].chord).toEqual(typed("sus4", { inversion: 1, voicing: "open" }));
  });
});
