import { describe, expect, it } from "vitest";
import { compileInstrumentNote, compileInstrumentNotes, compileNote, compilePatternIteration } from "../src/audio/compile";
import { effectiveVelocity } from "../src/audio/trackLfo";
import { createEventLfo, setNoteLfo, setTrackEventLfo, setTrackNotesLfo } from "../src/model/eventLfo";
import { createInitialProject, addNote, assignAsset, addAsset } from "../src/model/project";
import { setTrackInstrument } from "../src/model/instruments";
import { copyTrackConfig, pasteTrackConfig } from "../src/model/trackConfig";
import type { Note, Track, TrackEventLfo } from "../src/model/types";

// A square LFO makes the value exactly +1 (first half of a cycle) or -1 (second half), so the
// expected velocities below are exact. Synced to 1/4 at 120 BPM a cycle is 0.5 s; anchor at t=10.
const lfo = (patch: Partial<TrackEventLfo> = {}): TrackEventLfo => ({
  ...createEventLfo(),
  enabled: true,
  waveform: "square",
  sync: true,
  division: "1/4",
  depth: 0.2,
  ...patch,
});
const track = (eventLfo?: TrackEventLfo): Track => ({
  id: "t", assetId: 1, name: "x", fx: [], automation: [], volume: 1, muted: false, soloed: false, eventLfo,
});
const note = (patch: Partial<Note> = {}): Note => ({ id: "n", trackId: "t", start: 0, duration: 1, velocity: 0.5, lfo: 1, ...patch });
const clock = { anchorTime: 10, bpm: 120 };
const HIGH = 10.1; // first half of the cycle: LFO = +1
const LOW = 10.3; // second half: LFO = -1

describe("effectiveVelocity", () => {
  it("is the base velocity when there is no LFO, it is disabled, or no clock", () => {
    expect(effectiveVelocity(track(), note(), HIGH, clock)).toBe(0.5);
    expect(effectiveVelocity(track(lfo({ enabled: false })), note(), HIGH, clock)).toBe(0.5);
    expect(effectiveVelocity(track(lfo()), note(), HIGH, undefined)).toBe(0.5);
  });

  it("is the base velocity for a step that does not participate", () => {
    expect(effectiveVelocity(track(lfo()), note({ lfo: 0 }), HIGH, clock)).toBe(0.5);
    expect(effectiveVelocity(track(lfo()), note({ lfo: undefined }), HIGH, clock)).toBe(0.5);
  });

  it("adds the bipolar LFO x depth x participation", () => {
    expect(effectiveVelocity(track(lfo()), note(), HIGH, clock)).toBeCloseTo(0.7); // +1 x 0.2
    expect(effectiveVelocity(track(lfo()), note(), LOW, clock)).toBeCloseTo(0.3); // -1 x 0.2
    expect(effectiveVelocity(track(lfo()), note({ lfo: 0.5 }), HIGH, clock)).toBeCloseTo(0.6);
    expect(effectiveVelocity(track(lfo({ depth: 0.3 })), note({ velocity: 0.8, lfo: 0.5 }), LOW, clock)).toBeCloseTo(0.65);
  });

  it("clamps to 0..1", () => {
    expect(effectiveVelocity(track(lfo({ depth: 1 })), note({ velocity: 0.95 }), HIGH, clock)).toBe(1);
    expect(effectiveVelocity(track(lfo({ depth: 1 })), note({ velocity: 0.05 }), LOW, clock)).toBe(0);
  });

  it("free mode runs at its own rate from the anchor", () => {
    const free = track(lfo({ sync: false, rateHz: 2 })); // 0.5 s cycle, same as 1/4 @ 120
    expect(effectiveVelocity(free, note(), HIGH, clock)).toBeCloseTo(0.7);
    expect(effectiveVelocity(free, note(), LOW, clock)).toBeCloseTo(0.3);
    // Tempo does not matter in free mode, it does in sync mode.
    expect(effectiveVelocity(free, note(), LOW, { ...clock, bpm: 60 })).toBeCloseTo(0.3);
    expect(effectiveVelocity(track(lfo()), note(), LOW, { ...clock, bpm: 60 })).toBeCloseTo(0.7);
  });

  it("is deterministic", () => {
    const t = track(lfo({ waveform: "sine", sync: false, rateHz: 3.7 }));
    expect(effectiveVelocity(t, note(), 12.345, clock)).toBe(effectiveVelocity(t, note(), 12.345, clock));
  });
});

describe("event timing", () => {
  const synth: Track = { ...track(lfo({ division: "1/32" })), assetId: null, instrument: { kind: "bass", params: {} } };

  it("evaluates the LFO at the event's scheduled time, swing included", () => {
    // 1/32 at 120 BPM: a 0.0625 s cycle (+ for 0.03125 s, then -). Step 1 (odd 16th) sits at
    // 0.125 s after the step start: straight = cycle start (+); with swing 0.75 it moves 0.03125 s
    // later = start of the second half (-).
    const n = note({ start: 1 });
    const straight = compileInstrumentNote(synth, n, 120, 10, 0.5, 10)!;
    const swung = compileInstrumentNote(synth, n, 120, 10, 0.75, 10)!;
    expect(straight.velocity).toBeCloseTo(0.7);
    expect(swung.time).toBeCloseTo(10.15625);
    expect(swung.velocity).toBeCloseTo(0.3);
  });

  it("uses the scheduled time, not 'now': the same step in a later pattern iteration gets the later phase", () => {
    const pattern = { id: "p", name: "p", bars: 1, notes: { n: note({ start: 0 }) } };
    const t: Track = { ...synth, eventLfo: lfo({ division: "1/4" }) };
    const first = compileInstrumentNotes(pattern, [t], 120, 10, 0.5, 10)[0].params.velocity;
    const quarterLater = compileInstrumentNotes(pattern, [t], 120, 10.2, 0.5, 10)[0].params.velocity;
    expect(first).toBeCloseTo(0.7);
    expect(quarterLater).toBeCloseTo(0.7); // 0.2 s: still the first half
    const later = compileInstrumentNotes(pattern, [t], 120, 10.3, 0.5, 10)[0].params.velocity;
    expect(later).toBeCloseTo(0.3); // 0.3 s: second half
    // The LFO is anchored to the transport, not to the pattern: a later step start continues the cycle.
    expect(compileInstrumentNotes(pattern, [t], 120, 10.6, 0.5, 10)[0].params.velocity).toBeCloseTo(0.7);
  });

  it("modulates sample tracks' gain the same way", () => {
    const e = compileNote(track(lfo()), note({ start: 0 }), 120, HIGH, undefined, 0.5, 10)!;
    expect(e.gain).toBeCloseTo(0.7);
    expect(compileNote(track(lfo()), note({ start: 0 }), 120, LOW, undefined, 0.5, 10)!.gain).toBeCloseTo(0.3);
  });

  it("never changes the stored note", () => {
    const n = note();
    const before = JSON.stringify(n);
    compileNote(track(lfo()), n, 120, 10, undefined, 0.5, 10);
    compileInstrumentNote(synth, n, 120, 10.3, 0.5, 10);
    expect(JSON.stringify(n)).toBe(before);
    expect(n.velocity).toBe(0.5);
  });
});

describe("regression: projects without a Track LFO", () => {
  it("compile output is identical with or without the anchor when nothing is configured", () => {
    let p = createInitialProject();
    p = addAsset(p, { id: 5, name: "k", type: "audio", duration: 1, sampleRate: 48000, channels: 1, origin: "import" });
    p = assignAsset(p, "track-1", 5);
    p = addNote(p, p.patterns[0].id, "track-1", 0);
    p = addNote(p, p.patterns[0].id, "track-1", 4);
    const without = compilePatternIteration(p.patterns[0], p.tracks, 120, 10);
    const withAnchor = compilePatternIteration(p.patterns[0], p.tracks, 120, 10, () => undefined, 0.5, 10);
    expect(withAnchor).toEqual(without);
    expect(without.every((e) => e.gain === 1 || e.gain === undefined || typeof e.gain === "number")).toBe(true);
    // An LFO that is configured but disabled, or enabled with no participating steps, changes nothing either.
    const off = { ...p, tracks: p.tracks.map((t) => (t.id === "track-1" ? { ...t, eventLfo: lfo({ enabled: false }) } : t)) };
    expect(compilePatternIteration(off.patterns[0], off.tracks, 120, 10, () => undefined, 0.5, 10)).toEqual(without);
    const noSteps = { ...p, tracks: p.tracks.map((t) => (t.id === "track-1" ? { ...t, eventLfo: lfo() } : t)) };
    expect(compilePatternIteration(noSteps.patterns[0], noSteps.tracks, 120, 10, () => undefined, 0.5, 10)).toEqual(without);
  });
});

describe("model, copy and persistence", () => {
  it("sets participation per step and per track; 0 is stored as absent", () => {
    let p = createInitialProject();
    const pid = p.patterns[0].id;
    p = addNote(p, pid, "track-1", 0);
    p = addNote(p, pid, "track-1", 4);
    p = addNote(p, pid, "track-2", 0);
    const ids = Object.keys(p.patterns[0].notes);
    p = setNoteLfo(p, pid, ids[0], 0.55);
    expect(p.patterns[0].notes[ids[0]].lfo).toBe(0.55);
    p = setNoteLfo(p, pid, ids[0], 7);
    expect(p.patterns[0].notes[ids[0]].lfo).toBe(1);
    p = setNoteLfo(p, pid, ids[0], 0);
    expect("lfo" in p.patterns[0].notes[ids[0]]).toBe(false);
    p = setTrackNotesLfo(p, pid, "track-1", 1);
    const notes = Object.values(p.patterns[0].notes);
    expect(notes.filter((n) => n.trackId === "track-1").every((n) => n.lfo === 1)).toBe(true);
    expect(notes.filter((n) => n.trackId === "track-2").every((n) => n.lfo === undefined)).toBe(true);
    p = setTrackNotesLfo(p, pid, "track-1", 0);
    expect(Object.values(p.patterns[0].notes).some((n) => "lfo" in n)).toBe(false);
  });

  it("edits the track LFO with clamping and leaves other tracks alone", () => {
    let p = setTrackEventLfo(createInitialProject(), "track-1", { enabled: true, depth: 9, rateHz: 999, waveform: "saw", division: "1/8" });
    expect(p.tracks[0].eventLfo).toMatchObject({ enabled: true, depth: 1, rateHz: 40, waveform: "saw", division: "1/8", target: "velocity" });
    expect(p.tracks[1].eventLfo).toBeUndefined();
    p = setTrackEventLfo(p, "track-1", { enabled: false });
    expect(p.tracks[0].eventLfo?.waveform).toBe("saw");
  });

  it("survives save/load (JSON), keeps the authored velocity, and copies with the track config", () => {
    let p = createInitialProject();
    const pid = p.patterns[0].id;
    p = setTrackInstrument(p, "track-1", "hihat");
    p = addNote(p, pid, "track-1", 0);
    const id = Object.keys(p.patterns[0].notes)[0];
    p = setNoteLfo(p, pid, id, 0.5);
    p = setTrackEventLfo(p, "track-1", { enabled: true, waveform: "triangle", sync: false, rateHz: 3, depth: 0.4 });
    const loaded = JSON.parse(JSON.stringify(p));
    expect(loaded.tracks[0].eventLfo).toEqual(p.tracks[0].eventLfo);
    expect(loaded.patterns[0].notes[id].lfo).toBe(0.5);
    expect(loaded.patterns[0].notes[id].velocity).toBe(p.patterns[0].notes[id].velocity);
    const pasted = pasteTrackConfig(p, "track-2", copyTrackConfig(p.tracks[0]));
    expect(pasted.tracks[1].eventLfo).toEqual(p.tracks[0].eventLfo);
    expect(pasted.tracks[1].eventLfo).not.toBe(p.tracks[0].eventLfo);
  });
});
