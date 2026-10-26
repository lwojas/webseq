import { describe, expect, it } from "vitest";
import { compileInstrumentNotes, secondsPerBeat } from "../src/audio/compile";
import { compileNativeSequence } from "../src/audio/nativeSequence";
import { setTrackInstrument, supportsTie } from "../src/model/instruments";
import { addNote } from "../src/model/notes";
import { createInitialProject, setNoteTie, setTrackNotesTie } from "../src/model/project";
import { parseProjectFile, serializeProjectFile } from "../src/persistence/projectFile";
import type { Project } from "../src/model/types";

const SPB = secondsPerBeat(120);
const ctx = { getBusId: () => undefined, instrumentIdFor: () => 1, hasSample: () => true, automation: () => [] };

/** Three bass notes on track-1 (steps 0, 4, 8; 2 steps long), optionally tying the first. */
function bass(kind: "bass" | "kick" = "bass", tieFirst = false): Project {
  let p = setTrackInstrument(createInitialProject("t", 2), "track-1", kind);
  let pat = p.patterns[0];
  for (const start of [0, 4, 8]) pat = addNote(pat, p.beatsPerBar, "track-1", start, 2, 1);
  p = { ...p, patterns: [pat] };
  if (tieFirst) {
    const first = Object.values(pat.notes).find((n) => n.start === 0)!;
    p = setNoteTie(p, pat.id, first.id, true);
  }
  return p;
}
const compile = (p: Project) => compileInstrumentNotes(p.patterns[0], p.tracks, 120, 0).sort((a, b) => a.params.time! - b.params.time!);

describe("tie", () => {
  it("only synths with a legato mode can tie", () => {
    expect(supportsTie(bass().tracks[0])).toBe(true);
    expect(supportsTie(bass("kick").tracks[0])).toBe(false);
  });

  it("an untied sequence compiles exactly as before", () => {
    const notes = compile(bass());
    expect(notes).toHaveLength(3);
    notes.forEach((n) => expect(n.params.tie).toBeUndefined());
    expect(notes[0].params.duration).toBeCloseTo(2 * SPB);
  });

  it("a tied note holds through the next note's start, and only the next note glides in", () => {
    const notes = compile(bass("bass", true));
    expect(notes[0].params.tie).toBeUndefined();
    expect(notes[1].params.tie).toBe(true);
    expect(notes[2].params.tie).toBeUndefined();
    // Gate reaches the second note's start (step 4) and a little past it.
    expect(notes[0].params.time! + notes[0].params.duration!).toBeGreaterThan(4 * SPB);
    expect(notes[0].params.time! + notes[0].params.duration!).toBeLessThan(5 * SPB);
    expect(notes[1].params.duration).toBeCloseTo(2 * SPB); // the tied-in note keeps its own gate
  });

  it("a tie on the last note of a pattern, or on a synth without legato, does nothing", () => {
    let p = bass();
    const pat = p.patterns[0];
    const last = Object.values(pat.notes).find((n) => n.start === 8)!;
    p = setNoteTie(p, pat.id, last.id, true);
    compile(p).forEach((n) => expect(n.params.tie).toBeUndefined());
    const kick = setTrackNotesTie(bass("kick"), bass("kick").patterns[0].id, "track-1", true);
    compile(kick).forEach((n) => expect(n.params.tie).toBeUndefined());
  });

  it("works with ratchets: the last hit of the tied note holds, every hit of the next is plain except it ties in", () => {
    let p = bass("bass", true);
    const pat = p.patterns[0];
    const first = Object.values(pat.notes).find((n) => n.start === 0)!;
    p = { ...p, patterns: [{ ...pat, notes: { ...pat.notes, [first.id]: { ...first, ratchet: 2 } } }] };
    const notes = compile(p);
    expect(notes).toHaveLength(4);
    expect(notes[0].params.duration).toBeCloseTo(SPB); // first hit: its own slot
    expect(notes[1].params.time! + notes[1].params.duration!).toBeGreaterThan(4 * SPB); // last hit holds
  });

  it("reaches the native sequence as tie: true", () => {
    const seq = compileNativeSequence(bass("bass", true), ctx)!;
    expect(seq.events.map((e) => (e.kind === "instrument" ? !!e.tie : null))).toEqual([false, true, false]);
  });

  it("All / None toggle every step and untied steps stay byte-identical", () => {
    let p = bass();
    const id = p.patterns[0].id;
    p = setTrackNotesTie(p, id, "track-1", true);
    expect(Object.values(p.patterns[0].notes).every((n) => n.tie === true)).toBe(true);
    p = setTrackNotesTie(p, id, "track-1", false);
    expect(Object.values(p.patterns[0].notes).every((n) => !("tie" in n))).toBe(true);
  });

  it("survives save and load", () => {
    const p = bass("bass", true);
    const opened = parseProjectFile(serializeProjectFile(p, new Map()));
    expect(Object.values(opened.project.patterns[0].notes).filter((n) => n.tie)).toHaveLength(1);
  });
});
