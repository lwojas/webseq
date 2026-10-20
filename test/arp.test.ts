import { describe, expect, it } from "vitest";
import {
  ARP_MODES,
  ARP_PATTERNS,
  ARP_RATES,
  arpOf,
  arpPool,
  arpRateSteps,
  arpStepVelocity,
  arpTrackNotes,
  createArp,
  expandArpGroup,
  isArpActive,
  normalizeArp,
  patchArp,
  setTrackArp,
  type ArpRun,
  type TrackArp,
} from "../src/model/arp";
import { compileInstrumentNotes, compilePatternIteration } from "../src/audio/compile";
import { addNote, createInitialProject, setNotePitch } from "../src/model/project";
import { setTrackInstrument } from "../src/model/instruments";
import { copyTrackConfig, pasteTrackConfig } from "../src/model/trackConfig";
import type { Note, Pattern, Track } from "../src/model/types";

const arp = (patch: Partial<TrackArp> = {}): TrackArp => ({ ...createArp(), enabled: true, ...patch });
/** Three C-major-ish notes, each a 4-step gate window: C E G at steps 0, 4, 8. */
const chord = (): ArpRun[] => [
  { start: 0, length: 4, pitch: 0, velocity: 1 },
  { start: 4, length: 4, pitch: 4, velocity: 1 },
  { start: 8, length: 4, pitch: 7, velocity: 1 },
];
const pitches = (steps: { pitch: number }[]) => steps.map((s) => s.pitch);
const starts = (steps: { start: number }[]) => steps.map((s) => s.start);

describe("arp config", () => {
  it("is disabled by default and for a track that predates it", () => {
    expect(createArp().enabled).toBe(false);
    expect(isArpActive({})).toBe(false);
    expect(arpOf({})).toEqual(createArp());
  });

  it("clamps and defaults partial data", () => {
    const n = normalizeArp({ octaves: 9, gate: 0, rate: "bogus", mode: "bogus" as never, pattern: "bogus", velocity: { mode: "accent", amount: 3, steps: [2, -1] } });
    expect(n).toMatchObject({ octaves: 4, gate: 0.05, rate: "1/16", mode: "up", pattern: "1232" });
    expect(n.velocity).toEqual({ mode: "accent", amount: 1, steps: [1, 0] });
    expect(normalizeArp({ velocity: { mode: "source", amount: 1, steps: [] } }).velocity.steps.length).toBeGreaterThan(0);
  });

  it("patches velocity without losing sibling fields", () => {
    const a = patchArp(createArp(), { velocity: { mode: "pattern" } });
    expect(a.velocity.mode).toBe("pattern");
    expect(a.velocity.steps).toEqual(createArp().velocity.steps);
    const project = setTrackArp(createInitialProject(), "track-2", { enabled: true, rate: "1/8" });
    expect(project.tracks[1].arp).toMatchObject({ enabled: true, rate: "1/8" });
    expect(project.tracks[0].arp).toBeUndefined();
  });

  it("offers every requested rate and mode", () => {
    for (const id of ["1/1", "1/2", "1/4", "1/8", "1/16", "1/32"]) expect(ARP_RATES.some((r) => r.id === id)).toBe(true);
    expect(ARP_MODES.map((m) => m.id)).toEqual(["up", "down", "updown", "downup", "random", "played", "pattern"]);
    expect(ARP_PATTERNS.length).toBeGreaterThanOrEqual(4);
  });
});

describe("arp note order", () => {
  it("up / down / up-down / down-up cycle the pool without repeating the turning points", () => {
    const run = (mode: TrackArp["mode"]) => pitches(expandArpGroup(arp({ mode, rate: "1/8" }), chord()));
    expect(run("up")).toEqual([0, 4, 7, 0, 4, 7]);
    expect(run("down")).toEqual([7, 4, 0, 7, 4, 0]);
    expect(run("updown")).toEqual([0, 4, 7, 4, 0, 4]);
    expect(run("downup")).toEqual([7, 4, 0, 4, 7, 4]);
  });

  it("plays 'as played' in time order, not pitch order", () => {
    const runs: ArpRun[] = [
      { start: 0, length: 2, pitch: 7, velocity: 1 },
      { start: 2, length: 2, pitch: 0, velocity: 1 },
      { start: 4, length: 2, pitch: 4, velocity: 1 },
    ];
    expect(pitches(expandArpGroup(arp({ mode: "played", rate: "1/16" }), runs))).toEqual([7, 0, 4, 7, 0, 4]);
  });

  it("runs a named pattern over the pool, wrapping indices past it", () => {
    const steps = expandArpGroup(arp({ mode: "pattern", pattern: "1324", rate: "1/8" }), chord());
    // pool 0 4 7: 1->0, 3->7, 2->4, 4 wraps -> 0
    expect(pitches(steps)).toEqual([0, 7, 4, 0, 0, 7]);
  });

  it("treats 0 in a pattern as a rest that still advances the pattern", () => {
    const steps = expandArpGroup(arp({ mode: "pattern", pattern: "push", rate: "1/16" }), [{ start: 0, length: 8, pitch: 0, velocity: 1 }, { start: 8, length: 0, pitch: 7, velocity: 1 }]);
    // pattern 1 0 2 3 over pool [0, 7]: steps 0,2,3 sound; 3 wraps to 0
    expect(starts(steps).slice(0, 3)).toEqual([0, 2, 3]);
    expect(pitches(steps).slice(0, 3)).toEqual([0, 7, 0]);
  });

  it("is deterministic in random mode and only uses pool pitches", () => {
    const a = expandArpGroup(arp({ mode: "random", rate: "1/16" }), chord(), 3);
    const b = expandArpGroup(arp({ mode: "random", rate: "1/16" }), chord(), 3);
    expect(a).toEqual(b);
    expect(a.length).toBe(12);
    expect(a.every((s) => [0, 4, 7].includes(s.pitch))).toBe(true);
    const other = expandArpGroup(arp({ mode: "random", rate: "1/16" }), chord(), 4);
    expect(pitches(other)).not.toEqual(pitches(a));
  });
});

describe("arp octave range", () => {
  it("repeats the pool upward", () => {
    expect(arpPool(arp({ octaves: 2 }), chord())).toEqual([0, 4, 7, 12, 16, 19]);
    const runs: ArpRun[] = [0, 4, 7].map((p, i) => ({ start: i * 2, length: 2, pitch: p, velocity: 1 }));
    expect(pitches(expandArpGroup(arp({ octaves: 2, rate: "1/16" }), runs))).toEqual([0, 4, 7, 12, 16, 19]);
    expect(arpPool(arp({ octaves: 3, mode: "played" }), [{ start: 0, length: 1, pitch: 5, velocity: 1 }])).toEqual([5, 17, 29]);
  });

  it("dedupes repeated pitches for sorted modes", () => {
    const runs: ArpRun[] = [0, 0, 7].map((p, i) => ({ start: i, length: 1, pitch: p, velocity: 1 }));
    expect(arpPool(arp(), runs)).toEqual([0, 7]);
  });
});

describe("arp rhythm and gate", () => {
  it("subdivides each gate window by the rate", () => {
    const one: ArpRun[] = [{ start: 0, length: 4, pitch: 0, velocity: 1 }];
    const count = (rate: string) => expandArpGroup(arp({ rate }), one).length;
    expect(arpRateSteps("1/32")).toBe(0.5);
    expect([count("1/4"), count("1/8"), count("1/16"), count("1/32")]).toEqual([1, 2, 4, 8]);
    expect(count("1/1")).toBe(1);
    expect(starts(expandArpGroup(arp({ rate: "1/32" }), [{ start: 0, length: 2, pitch: 0, velocity: 1 }]))).toEqual([0, 0.5, 1, 1.5]);
  });

  it("supports triplets and dotted values", () => {
    const s = starts(expandArpGroup(arp({ rate: "1/8T" }), [{ start: 0, length: 4, pitch: 0, velocity: 1 }]));
    expect(s.length).toBe(3);
    expect(s[1]).toBeCloseTo(4 / 3, 9);
    expect(starts(expandArpGroup(arp({ rate: "1/8." }), [{ start: 0, length: 6, pitch: 0, velocity: 1 }]))).toEqual([0, 3]);
  });

  it("starts the first step on the note's own start (off-grid starts included)", () => {
    expect(starts(expandArpGroup(arp({ rate: "1/8" }), [{ start: 1, length: 4, pitch: 0, velocity: 1 }]))).toEqual([1, 3]);
  });

  it("scales step length by gate and never runs past the window", () => {
    const g = expandArpGroup(arp({ rate: "1/8", gate: 0.5 }), [{ start: 0, length: 4, pitch: 0, velocity: 1 }]);
    expect(g.map((s) => s.length)).toEqual([1, 1]);
    const tail = expandArpGroup(arp({ rate: "1/16", gate: 1 }), [{ start: 0, length: 1.5, pitch: 0, velocity: 1 }]);
    expect(tail.map((s) => s.length)).toEqual([1, 0.5]);
  });
});

describe("arp velocity", () => {
  const steps = [1, 0.5];
  it("source mode keeps the note's velocity", () => {
    expect(arpStepVelocity(0.8, { mode: "source", amount: 1, steps }, 1)).toBe(0.8);
  });
  it("pattern mode blends source toward the pattern level by amount", () => {
    expect(arpStepVelocity(0.8, { mode: "pattern", amount: 1, steps }, 1)).toBe(0.5);
    expect(arpStepVelocity(0.8, { mode: "pattern", amount: 0, steps }, 1)).toBe(0.8);
    expect(arpStepVelocity(0.8, { mode: "pattern", amount: 0.5, steps }, 1)).toBeCloseTo(0.65, 9);
  });
  it("accent mode only ever scales the source down", () => {
    expect(arpStepVelocity(0.8, { mode: "accent", amount: 1, steps }, 1)).toBeCloseTo(0.4, 9);
    expect(arpStepVelocity(0.8, { mode: "accent", amount: 1, steps }, 0)).toBe(0.8);
    expect(arpStepVelocity(0.8, { mode: "accent", amount: 0.5, steps }, 1)).toBeCloseTo(0.6, 9);
  });
  it("cycles the pattern per arp step and applies it to generated notes", () => {
    const a = arp({ rate: "1/16", velocity: { mode: "pattern", amount: 1, steps: [1, 0.5, 0.75, 0.25] } });
    const out = expandArpGroup(a, [{ start: 0, length: 6, pitch: 0, velocity: 0.9 }]);
    expect(out.map((s) => s.velocity)).toEqual([1, 0.5, 0.75, 0.25, 1, 0.5]);
  });
});

describe("arp edge cases", () => {
  it("returns nothing for no source material", () => {
    expect(expandArpGroup(arp(), [])).toEqual([]);
    expect(arpTrackNotes([], arp(), 16, 16)).toEqual([]);
  });
  it("arpeggiates a single note over its octave range", () => {
    const out = expandArpGroup(arp({ octaves: 2, rate: "1/16" }), [{ start: 0, length: 4, pitch: 3, velocity: 1 }]);
    expect(pitches(out)).toEqual([3, 15, 3, 15]);
    expect(pitches(expandArpGroup(arp({ mode: "updown", rate: "1/16" }), [{ start: 0, length: 3, pitch: 3, velocity: 1 }]))).toEqual([3, 3, 3]);
  });
  it("skips zero-length runs", () => {
    expect(expandArpGroup(arp(), [{ start: 0, length: 0, pitch: 0, velocity: 1 }])).toEqual([]);
  });
});

const note = (id: string, start: number, duration: number, pitch?: number, extra: Partial<Note> = {}): Note => ({
  id,
  trackId: "track-1",
  start,
  duration,
  velocity: 0.8,
  ...(pitch ? { pitch } : {}),
  ...extra,
});

describe("arpTrackNotes (webseq adapter)", () => {
  it("builds notes from the bar's pitches, windowed by the stored notes", () => {
    const out = arpTrackNotes([note("a", 0, 2, 0), note("b", 4, 2, 4), note("c", 8, 2, 7)], arp({ rate: "1/16" }), 16, 16);
    expect(out.map((n) => n.start)).toEqual([0, 1, 4, 5, 8, 9]);
    expect(out.map((n) => n.pitch ?? 0)).toEqual([0, 4, 7, 0, 4, 7]);
    expect(out.every((n) => n.trackId === "track-1")).toBe(true);
    expect(out[0].id).toBe("a~0");
    expect(out[0].duration).toBeCloseTo(0.8, 9);
  });

  it("keeps bars independent and clips runs at the bar line", () => {
    const out = arpTrackNotes([note("a", 14, 6, 0), note("b", 16, 2, 7)], arp({ rate: "1/16" }), 16, 32);
    expect(out.map((n) => n.start)).toEqual([14, 15, 16, 17]);
    // bar 0's pool is only {0}; bar 1's only {7}
    expect(out.map((n) => n.pitch ?? 0)).toEqual([0, 0, 7, 7]);
  });

  it("clips at the pattern end, carries lfo participation, and clamps pitch", () => {
    const out = arpTrackNotes([note("a", 30, 8, 47, { lfo: 0.5 })], arp({ rate: "1/16", octaves: 2 }), 16, 32);
    expect(out.map((n) => n.start)).toEqual([30, 31]);
    expect(out.map((n) => n.pitch)).toEqual([47, 48]);
    expect(out.every((n) => n.lfo === 0.5)).toBe(true);
  });

  it("is deterministic and leaves its input alone", () => {
    const input = [note("a", 0, 4, 0), note("b", 4, 4, 5)];
    const copy = JSON.stringify(input);
    const a = arpTrackNotes(input, arp({ mode: "random" }), 16, 16);
    expect(arpTrackNotes(input, arp({ mode: "random" }), 16, 16)).toEqual(a);
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe("arp in the compile path", () => {
  const pattern: Pattern = { id: "p", name: "P", bars: 1, notes: {} };
  function sampleTracks(withArp?: TrackArp): Track[] {
    const t = createInitialProject().tracks.slice(0, 2).map((x, i) => ({ ...x, assetId: i + 1 }));
    if (withArp) t[0] = { ...t[0], arp: withArp };
    return t;
  }
  const withNotes = (notes: Note[]): Pattern => ({ ...pattern, notes: Object.fromEntries(notes.map((n) => [n.id, n])) });
  const source = withNotes([note("a", 0, 2, 0), note("b", 4, 2, 4), note("c", 8, 2, 7)]);

  it("an absent, or disabled, arp compiles exactly the stored notes", () => {
    const plain = compilePatternIteration(source, sampleTracks(), 120, 5);
    expect(plain.length).toBe(3);
    expect(compilePatternIteration(source, sampleTracks({ ...createArp(), rate: "1/32", octaves: 4 }), 120, 5)).toEqual(plain);
  });

  it("an enabled arp compiles the generated notes at sub-step times", () => {
    const spb = 60 / (120 * 4);
    const events = compilePatternIteration(source, sampleTracks(arp({ rate: "1/32" })), 120, 5);
    expect(events.length).toBe(12);
    expect(events[1].time).toBeCloseTo(5 + 0.5 * spb, 9);
    expect(events.map((e) => e.pitch ?? 0).slice(0, 4)).toEqual([0, 4, 7, 0]);
  });

  it("does not touch other tracks", () => {
    const both = withNotes([note("a", 0, 2, 0), { ...note("x", 0, 2, 3), id: "x", trackId: "track-2" }]);
    const events = compilePatternIteration(both, sampleTracks(arp({ rate: "1/32" })), 120, 0);
    expect(events.filter((e) => e.sampleId === 2).length).toBe(1);
    expect(events.filter((e) => e.sampleId === 1).length).toBe(4);
  });

  it("feeds synth tracks the same way", () => {
    let project = setTrackInstrument(createInitialProject(), "track-1", "bass");
    const pid = project.patterns[0].id;
    project = addNote(project, pid, "track-1", 0);
    project = addNote(project, pid, "track-1", 2);
    const ids = Object.keys(project.patterns[0].notes);
    project = setNotePitch(project, pid, ids[1], 5);
    const off = compileInstrumentNotes(project.patterns[0], project.tracks, 120, 0, 0.5, undefined, 16);
    expect(off.length).toBe(2);
    project = setTrackArp(project, "track-1", { enabled: true, rate: "1/32", gate: 1 });
    const on = compileInstrumentNotes(project.patterns[0], project.tracks, 120, 0, 0.5, undefined, 16);
    expect(on.length).toBe(4);
    expect(on.map((n) => n.params.pitch ?? 0)).toEqual([0, 5, 0, 5]);
  });
});

describe("arp persistence helpers", () => {
  it("copies and pastes with the track config, without sharing state", () => {
    let project = setTrackArp(createInitialProject(), "track-1", { enabled: true, rate: "1/8", velocity: { steps: [1, 0.3] } });
    const config = copyTrackConfig(project.tracks[0]);
    project = pasteTrackConfig(project, "track-2", config);
    expect(project.tracks[1].arp).toEqual(project.tracks[0].arp);
    expect(project.tracks[1].arp!.velocity.steps).not.toBe(project.tracks[0].arp!.velocity.steps);
  });

  it("round-trips through JSON", () => {
    const a = patchArp(createArp(), { enabled: true, mode: "pattern", pattern: "tresillo", octaves: 3 });
    expect(normalizeArp(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });
});
