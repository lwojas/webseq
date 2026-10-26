import { describe, expect, it } from "vitest";
import { compileInstrumentNotes, compilePatternIteration, secondsPerBeat } from "../src/audio/compile";
import { compileNativeSequence } from "../src/audio/nativeSequence";
import { addNote } from "../src/model/notes";
import { createInitialProject, setNoteRatchet } from "../src/model/project";
import { setTrackInstrument } from "../src/model/instruments";
import { parseProjectFile, serializeProjectFile } from "../src/persistence/projectFile";
import { RATCHET_VALUES, ratchetOf } from "../src/model/types";
import type { Project } from "../src/model/types";

const ctx = { getBusId: () => undefined, instrumentIdFor: () => 1, hasSample: () => true, automation: () => [] };

/** One 2-step note at step 4 on track-1 (a sample), with the given ratchet. */
function withNote(ratchet?: number, synth = false): Project {
  let p = createInitialProject("t", 2);
  p = { ...p, tracks: p.tracks.map((t, i) => ({ ...t, assetId: i + 1 })) };
  if (synth) p = setTrackInstrument(p, "track-1", "bass");
  const pat = addNote(p.patterns[0], p.beatsPerBar, "track-1", 4, 2, 0.8);
  p = { ...p, patterns: [pat] };
  if (ratchet !== undefined) p = setNoteRatchet(p, pat.id, Object.keys(pat.notes)[0], ratchet);
  return p;
}
const events = (p: Project, bpm = 120, start = 10) => compilePatternIteration(p.patterns[0], p.tracks, bpm, start);

describe("ratchet", () => {
  it("1x and absent are the same event as before ratchets existed", () => {
    const plain = events(withNote());
    expect(plain).toHaveLength(1);
    expect(events(withNote(1))).toEqual(plain);
    expect(plain[0].time).toBeCloseTo(10 + 4 * 0.125);
    expect(plain[0].duration).toBeCloseTo(2 * 0.125);
    expect(Object.values(withNote(1).patterns[0].notes)[0]).not.toHaveProperty("ratchet"); // 1 is stored as absent
  });

  it.each([2, 3, 4, 6, 8])("%ix: n evenly spaced real triggers inside the step", (n) => {
    const p = withNote(n);
    const ev = events(p);
    const spb = secondsPerBeat(120);
    expect(ev).toHaveLength(n);
    ev.forEach((e, i) => {
      expect(e.time).toBeCloseTo(10 + 4 * spb + (i * 2 * spb) / n, 9);
      expect(e.duration).toBeCloseTo((2 * spb) / n, 9);
      expect(e.gain).toBe(0.8);
    });
    // The hits tile the step exactly: the last one ends where the step does.
    expect(ev[n - 1].time + ev[n - 1].duration!).toBeCloseTo(10 + 6 * spb, 9);
  });

  it("stays proportional to the step when the tempo changes", () => {
    for (const bpm of [40, 120, 300]) {
      const ev = events(withNote(4), bpm, 0);
      const step = 2 * secondsPerBeat(bpm);
      ev.forEach((e, i) => expect((e.time - 4 * secondsPerBeat(bpm)) / step).toBeCloseTo(i / 4, 9));
    }
  });

  it("synth notes retrigger too, each a full note-on with its own slot length", () => {
    const p = withNote(4, true);
    const notes = compileInstrumentNotes(p.patterns[0], p.tracks, 120, 0);
    const spb = secondsPerBeat(120);
    expect(notes).toHaveLength(4);
    notes.forEach((n, i) => {
      expect(n.params.time).toBeCloseTo(4 * spb + (i * 2 * spb) / 4, 9);
      expect(n.params.duration).toBeCloseTo((2 * spb) / 4, 9);
    });
  });

  it("only moves the step's own swing once: hits do not swing individually", () => {
    const p = { ...withNote(4), swing: 0.75 };
    const ev = compilePatternIteration(p.patterns[0], p.tracks, 120, 0, () => undefined, 0.75);
    const gaps = ev.slice(1).map((e, i) => e.time - ev[i].time);
    gaps.forEach((g) => expect(g).toBeCloseTo((2 * secondsPerBeat(120)) / 4, 9));
  });

  it("reaches the native sequence as ordinary events at quarter-note beats", () => {
    const seq = compileNativeSequence(withNote(4), ctx)!;
    expect(seq.events.map((e) => e.beat)).toEqual([1, 1.125, 1.25, 1.375].map((b) => expect.closeTo(b, 9)));
    expect(compileNativeSequence(withNote(), ctx)!.events).toHaveLength(1);
  });

  it("accepts only the supported counts and ignores a damaged value on playback", () => {
    expect(RATCHET_VALUES).toEqual([1, 2, 3, 4, 6, 8]);
    expect(Object.values(withNote(5).patterns[0].notes)[0].ratchet).toBeUndefined();
    expect(ratchetOf({ ratchet: 7 })).toBe(1);
    expect(ratchetOf({ ratchet: 3 })).toBe(3);
  });

  it("survives save and load, and an old file without it loads unchanged", () => {
    const p = withNote(6);
    const opened = parseProjectFile(serializeProjectFile(p, new Map()));
    expect(Object.values(opened.project.patterns[0].notes)[0].ratchet).toBe(6);
    const old = withNote();
    expect(parseProjectFile(serializeProjectFile(old, new Map())).project).toEqual(old);
  });
});
