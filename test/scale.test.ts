import { describe, expect, it } from "vitest";
import {
  SCALES,
  SCALE_PRESETS,
  applyScalePreset,
  createScale,
  formatScale,
  getNearestScaleNote,
  getNotesInRange,
  getScaleDegree,
  getScaleNotes,
  isChromatic,
  isNoteInScale,
  isOffsetInScale,
  nearestScaleOffset,
  normalizeScale,
  patchScale,
  referenceMidi,
  scaleOf,
  setProjectScale,
} from "../src/model/scale";
import { addNote, createInitialProject } from "../src/model/project";

const cMajor = { ...createScale(), root: 0, scale: "major" };
const aMinor = { ...createScale(), root: 9, scale: "minor" };

describe("scale definitions", () => {
  it("every scale starts on the root, ascends strictly and stays inside one octave", () => {
    for (const s of SCALES) {
      expect(s.intervals[0], s.id).toBe(0);
      s.intervals.forEach((v, i) => {
        expect(v, s.id).toBeLessThan(12);
        if (i > 0) expect(v, s.id).toBeGreaterThan(s.intervals[i - 1]);
      });
    }
  });

  it("defines the requested library with the right sizes", () => {
    const size = (id: string) => SCALES.find((s) => s.id === id)!.intervals.length;
    expect(SCALES.map((s) => s.id)).toEqual([
      "major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonicMinor", "melodicMinor",
      "pentatonicMajor", "pentatonicMinor", "blues", "wholeTone", "chromatic",
    ]);
    expect(["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonicMinor", "melodicMinor"].map(size)).toEqual(Array(9).fill(7));
    expect(size("pentatonicMajor")).toBe(5);
    expect(size("pentatonicMinor")).toBe(5);
    expect(size("blues")).toBe(6);
    expect(size("wholeTone")).toBe(6);
    expect(size("chromatic")).toBe(12);
  });

  it("uses the conventional interval patterns", () => {
    const iv = (id: string) => SCALES.find((s) => s.id === id)!.intervals;
    expect(iv("major")).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(iv("minor")).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(iv("dorian")).toEqual([0, 2, 3, 5, 7, 9, 10]);
    expect(iv("harmonicMinor")).toEqual([0, 2, 3, 5, 7, 8, 11]);
    expect(iv("blues")).toEqual([0, 3, 5, 6, 7, 10]);
  });
});

describe("scale queries", () => {
  it("computes scale pitch classes from the root", () => {
    expect(getScaleNotes(0, "major")).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(getScaleNotes(2, "minor")).toEqual([2, 4, 5, 7, 9, 10, 0]);
    expect(getScaleNotes(6, "pentatonicMinor")).toEqual([6, 9, 11, 1, 4]);
  });

  it("answers membership in every octave", () => {
    for (const octave of [24, 36, 60, 84]) {
      expect(isNoteInScale(aMinor, octave + 9)).toBe(true); // A
      expect(isNoteInScale(aMinor, octave + 0)).toBe(true); // C
      expect(isNoteInScale(aMinor, octave + 1)).toBe(false); // C#
    }
    expect(isChromatic(aMinor)).toBe(false);
    expect(isChromatic(createScale())).toBe(true);
    expect(isNoteInScale(createScale(), 61)).toBe(true);
  });

  it("gives 1-based scale degrees, null outside the scale", () => {
    expect(getScaleDegree(aMinor, 57)).toBe(1);
    expect(getScaleDegree(aMinor, 59)).toBe(2);
    expect(getScaleDegree(aMinor, 60)).toBe(3);
    expect(getScaleDegree(aMinor, 69)).toBe(1);
    expect(getScaleDegree(aMinor, 61)).toBeNull();
  });

  it("snaps to the nearest scale note, ties going down", () => {
    expect(getNearestScaleNote(cMajor, 60)).toBe(60);
    expect(getNearestScaleNote(cMajor, 61)).toBe(60); // C# is equidistant from C and D
    expect(getNearestScaleNote(cMajor, 66)).toBe(65); // F# between F and G
    expect(getNearestScaleNote(cMajor, 70)).toBe(69); // A# between A and B
    expect(getNearestScaleNote({ ...createScale(), scale: "pentatonicMajor" }, 65)).toBe(64); // F -> E
  });

  it("lists scale notes in a range", () => {
    expect(getNotesInRange(cMajor, 60, 72)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(getNotesInRange(cMajor, 61, 61)).toEqual([]);
  });

  it("treats a sample's offset 0 as the tonic and a synth's as its real root note", () => {
    expect(referenceMidi(aMinor, null)).toBe(69);
    expect(isOffsetInScale(aMinor, null, 0)).toBe(true);
    expect(isOffsetInScale(aMinor, null, 1)).toBe(false);
    expect(isOffsetInScale(aMinor, null, 3)).toBe(true);
    expect(isOffsetInScale(cMajor, 34, 0)).toBe(false); // synth root A#-1 is outside C major
    expect(isOffsetInScale(cMajor, 33, 0)).toBe(true); // A-1 is inside
    expect(nearestScaleOffset(cMajor, 36, 1)).toBe(0); // C-2 + 1 = C# -> C
  });
});

describe("project scale state", () => {
  it("defaults to chromatic for projects without one", () => {
    expect(scaleOf({})).toEqual({ root: 0, scale: "chromatic", snap: false, preset: null });
    expect(scaleOf({ scale: null })).toEqual(createScale());
  });

  it("normalises junk to safe values", () => {
    expect(normalizeScale({ root: 14, scale: "nope", snap: "yes" as never, preset: "ghost" })).toEqual({ root: 2, scale: "chromatic", snap: false, preset: null });
    expect(normalizeScale({ root: -3 }).root).toBe(9);
  });

  it("applies musical presets as root + scale, keeping snap, and labels them", () => {
    expect(SCALE_PRESETS.length).toBeGreaterThanOrEqual(11);
    for (const p of SCALE_PRESETS) expect(SCALES.some((s) => s.id === p.scale), p.id).toBe(true);
    const on = { ...createScale(), snap: true };
    const liquid = applyScalePreset(on, "liquidDnb");
    expect(liquid).toMatchObject({ root: 2, scale: "dorian", snap: true, preset: "liquidDnb" });
    expect(formatScale(liquid)).toBe("Liquid DnB (D Dorian)");
    expect(formatScale(aMinor)).toBe("A Minor");
    expect(applyScalePreset(on, "unknown")).toBe(on);
  });

  it("choosing a key by hand drops the preset label", () => {
    const liquid = applyScalePreset(createScale(), "liquidDnb");
    expect(patchScale(liquid, { root: 5 })).toMatchObject({ root: 5, scale: "dorian", preset: null });
    expect(patchScale(liquid, { snap: true })).toMatchObject({ preset: "liquidDnb", snap: true });
    expect(patchScale(createScale(), { preset: "acid", snap: true })).toMatchObject({ scale: "pentatonicMinor", snap: true, preset: "acid" });
  });

  it("changing the scale never rewrites a note", () => {
    let project = createInitialProject();
    const patternId = project.patterns[0].id;
    project = addNote(project, patternId, "track-1", 3);
    const before = JSON.stringify(project.patterns);
    const changed = setProjectScale(setProjectScale(project, { root: 7, scale: "dorian" }), { snap: true });
    expect(JSON.stringify(changed.patterns)).toBe(before);
    expect(changed.scale).toMatchObject({ root: 7, scale: "dorian", snap: true });
    expect(project.scale).toBeUndefined();
  });
});

describe("scale-aware note entry", () => {
  it("snaps a newly added note only when Snap is on, and never touches other notes", async () => {
    const { projectReducer } = await import("../src/model/reducer");
    let project = createInitialProject();
    const patternId = project.patterns[0].id;
    project = projectReducer(project, { type: "ADD_NOTE", patternId, trackId: "track-1", start: 0 });
    // a sample track (offset 0 = tonic) in C# major: the tonic is in scale, so nothing to snap
    project = projectReducer(project, { type: "SET_PROJECT_SCALE", patch: { root: 1, scale: "major", snap: true } });
    project = projectReducer(project, { type: "ADD_NOTE", patternId, trackId: "track-1", start: 4 });
    expect(Object.values(project.patterns[0].notes).map((n) => n.pitch ?? 0)).toEqual([0, 0]);

    // a synth whose root (A-1 = 33) lies outside D# major gets pulled onto the key; Snap off leaves it
    const { setTrackInstrument } = await import("../src/model/instruments");
    let synth = setTrackInstrument(createInitialProject(), "track-1", "bass");
    synth = projectReducer(synth, { type: "SET_PROJECT_SCALE", patch: { root: 3, scale: "major" } });
    const pid = synth.patterns[0].id;
    const unsnapped = projectReducer(synth, { type: "ADD_NOTE", patternId: pid, trackId: "track-1", start: 0 });
    expect(Object.values(unsnapped.patterns[0].notes)[0].pitch ?? 0).toBe(0);
    const snapped = projectReducer(projectReducer(synth, { type: "SET_PROJECT_SCALE", patch: { snap: true } }), { type: "ADD_NOTE", patternId: pid, trackId: "track-1", start: 0 });
    const first = Object.values(snapped.patterns[0].notes)[0];
    expect(isNoteInScale({ ...createScale(), root: 3, scale: "major" }, 33 + (first.pitch ?? 0))).toBe(true);
  });
});
