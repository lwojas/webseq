import { describe, expect, it } from "vitest";
import { compileLoopIteration, compileNote, secondsPerBeat } from "../src/audio/compile";
import { addNote, assignSample, createInitialState, setTempo } from "../src/model/pattern";
import type { Note, Track } from "../src/model/types";

describe("tempo conversion", () => {
  it("converts BPM into seconds per (sixteenth-note) beat", () => {
    expect(secondsPerBeat(120)).toBeCloseTo(0.125, 5); // 120bpm quarter = 0.5s, /4 = 0.125s
    expect(secondsPerBeat(60)).toBeCloseTo(0.25, 5);
    expect(secondsPerBeat(240)).toBeCloseTo(0.0625, 5);
  });
});

describe("compiling notes into webdsp scheduled events", () => {
  const track: Track = { id: "track-1", sampleId: 7, name: "kick.wav" };
  const note: Note = { id: "note-1", trackId: "track-1", start: 4, duration: 2, velocity: 0.8 };

  it("converts a musical position into an absolute engine time", () => {
    const event = compileNote(track, note, 120, /* loopStartTime */ 10, /* loopIndex */ 0, /* beatsPerLoop */ 16);
    expect(event).not.toBeNull();
    expect(event!.sampleId).toBe(7);
    expect(event!.time).toBeCloseTo(10 + 4 * 0.125, 5);
    expect(event!.gain).toBe(0.8);
  });

  it("converts note duration into a scheduled duration in seconds", () => {
    const event = compileNote(track, note, 120, 0, 0, 16);
    expect(event!.duration).toBeCloseTo(2 * 0.125, 5);
  });

  it("offsets later loop iterations by the full loop length", () => {
    const first = compileNote(track, note, 120, 0, 0, 16);
    const second = compileNote(track, note, 120, 0, 1, 16);
    expect(second!.time - first!.time).toBeCloseTo(16 * 0.125, 5);
  });

  it("returns null for a track with no sample assigned", () => {
    const unassigned: Track = { id: "track-2", sampleId: null, name: "— empty —" };
    expect(compileNote(unassigned, note, 120, 0, 0, 16)).toBeNull();
  });

  it("compiles every note across every track for one loop iteration", () => {
    let state = createInitialState();
    state = assignSample(state, "track-1", 1, "kick.wav");
    state = assignSample(state, "track-2", 2, "snare.wav");
    state = addNote(state, "track-1", 0);
    state = addNote(state, "track-1", 4);
    state = addNote(state, "track-2", 2);

    const events = compileLoopIteration(state, 0, 0);
    expect(events).toHaveLength(3);
    expect(events.filter((e) => e.sampleId === 1)).toHaveLength(2);
    expect(events.filter((e) => e.sampleId === 2)).toHaveLength(1);
  });

  it("skips notes on tracks with no assigned sample when compiling a loop", () => {
    let state = createInitialState();
    state = addNote(state, "track-1", 0); // no sample assigned
    const events = compileLoopIteration(state, 0, 0);
    expect(events).toHaveLength(0);
  });

  it("reflects a changed tempo in the compiled event timing", () => {
    let state = createInitialState();
    state = assignSample(state, "track-1", 1, "kick.wav");
    state = addNote(state, "track-1", 4);
    const before = compileLoopIteration(state, 0, 0)[0].time;

    state = setTempo(state, 240); // double tempo -> half the time per beat
    const after = compileLoopIteration(state, 0, 0)[0].time;

    expect(after).toBeCloseTo(before / 2, 5);
  });
});
