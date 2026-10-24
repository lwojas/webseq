import { describe, expect, it } from "vitest";
import { compileNativeSequence, type NativeSequenceContext } from "../src/audio/nativeSequence";
import { addNote } from "../src/model/notes";
import { createInitialProject } from "../src/model/project";
import type { Pattern, Project } from "../src/model/types";

const ctx = (over: Partial<NativeSequenceContext> = {}): NativeSequenceContext => ({
  getBusId: () => undefined,
  instrumentIdFor: () => undefined,
  hasSample: () => true,
  automation: () => [],
  ...over,
});

function project(): Project {
  const p = createInitialProject("t", 2);
  return { ...p, tracks: p.tracks.map((t, i) => ({ ...t, assetId: i + 1 })) };
}

describe("compileNativeSequence", () => {
  it("is null with nothing to play", () => {
    expect(compileNativeSequence(project(), ctx())).toBeNull();
  });

  it("puts a pattern's notes on the quarter-note timeline, whatever the project's own tempo", () => {
    for (const bpm of [90, 140]) {
      const p = project();
      p.bpm = bpm;
      let pat: Pattern = p.patterns[0];
      pat = addNote(pat, p.beatsPerBar, p.tracks[0].id, 4, 2, 0.5); // step 4 = quarter 1; 2 steps = half a quarter
      const seq = compileNativeSequence({ ...p, patterns: [pat] }, ctx())!;
      expect(seq.lengthBeats).toBeCloseTo(4); // one bar of sixteen steps
      expect(seq.events).toHaveLength(1);
      expect(seq.events[0]).toMatchObject({ kind: "sample", sample: 1, gain: 0.5 });
      expect(seq.events[0].beat).toBeCloseTo(1);
      expect((seq.events[0] as { durationBeats: number }).durationBeats).toBeCloseTo(0.5);
    }
  });

  it("walks the pattern queue in order, each step after the length of the one before", () => {
    const p = project();
    const a = addNote(p.patterns[0], p.beatsPerBar, p.tracks[0].id, 0);
    const b: Pattern = addNote({ id: "pb", name: "B", bars: 2, notes: {} }, p.beatsPerBar, p.tracks[1].id, 0);
    const seq = compileNativeSequence(
      { ...p, patterns: [a, b], patternChain: [{ id: "c1", patternId: a.id }, { id: "c2", patternId: "pb" }, { id: "c3", patternId: "gone" }] },
      ctx(),
    )!;
    expect(seq.lengthBeats).toBeCloseTo(12); // 4 + 8 quarters; the dangling entry is skipped, as the Transport skips it
    expect(seq.events.map((e) => [e.kind === "sample" ? e.sample : 0, Math.round(e.beat)])).toEqual([[1, 0], [2, 4]]);
  });

  it("leaves out samples the engine does not have, and carries automation through", () => {
    const p = project();
    let pat = addNote(p.patterns[0], p.beatsPerBar, p.tracks[0].id, 0);
    pat = addNote(pat, p.beatsPerBar, p.tracks[1].id, 8);
    const seq = compileNativeSequence(
      { ...p, patterns: [pat] },
      ctx({
        hasSample: (id) => id === 2,
        automation: (start, beats) => [{ beat: start / 4, kind: "param", target: { sample: 2 }, param: 0, value: beats }],
      }),
    )!;
    expect(seq.events.filter((e) => e.kind === "sample").map((e) => (e.kind === "sample" ? e.sample : 0))).toEqual([2]);
    expect(seq.events.some((e) => e.kind === "param" && e.value === 16)).toBe(true);
  });
});
