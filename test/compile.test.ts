import { describe, expect, it } from "vitest";
import { compileNote, compilePatternIteration, secondsPerBeat } from "../src/audio/compile";
import { addNote } from "../src/model/notes";
import { createInitialTracks } from "../src/model/project";
import type { Note, Pattern, Track } from "../src/model/types";

const BEATS_PER_BAR = 16;

describe("tempo conversion", () => {
  it("converts BPM into seconds per (sixteenth-note) beat", () => {
    expect(secondsPerBeat(120)).toBeCloseTo(0.125, 5);
    expect(secondsPerBeat(60)).toBeCloseTo(0.25, 5);
    expect(secondsPerBeat(240)).toBeCloseTo(0.0625, 5);
  });
});

describe("compiling notes into webdsp scheduled events", () => {
  const track: Track = { id: "track-1", assetId: 7, name: "kick.wav", fx: [], automation: [], volume: 1, muted: false, soloed: false };
  const note: Note = { id: "note-1", trackId: "track-1", start: 4, duration: 2, velocity: 0.8 };

  it("converts a musical position into an absolute engine time", () => {
    const event = compileNote(track, note, 120, /* stepStartTime */ 10);
    expect(event).not.toBeNull();
    expect(event!.sampleId).toBe(7);
    expect(event!.time).toBeCloseTo(10 + 4 * 0.125, 5);
    expect(event!.gain).toBe(0.8);
  });

  it("converts note duration into a scheduled duration in seconds", () => {
    const event = compileNote(track, note, 120, 0);
    expect(event!.duration).toBeCloseTo(2 * 0.125, 5);
  });

  it("returns null for a track with no sample assigned", () => {
    const unassigned: Track = {
      id: "track-2",
      assetId: null,
      name: "— empty —",
      fx: [],
      automation: [],
      volume: 1,
      muted: false,
      soloed: false,
    };
    expect(compileNote(unassigned, note, 120, 0)).toBeNull();
  });

  it("routes the event to the track's assigned bus when given one", () => {
    const event = compileNote(track, note, 120, 0, 3);
    expect(event!.bus).toBe(3);
  });

  it("omits `bus` entirely (so webdsp's own MASTER_BUS default applies) when none is given", () => {
    const event = compileNote(track, note, 120, 0);
    expect(event!.bus).toBeUndefined();
  });

  it("compiles every note across every track for one pattern playthrough", () => {
    const tracks = createInitialTracks(2).map((t, i) => ({ ...t, assetId: i + 1 }));
    let pattern: Pattern = { id: "p1", name: "Pattern A", bars: 1, notes: {} };
    pattern = addNote(pattern, BEATS_PER_BAR, tracks[0].id, 0);
    pattern = addNote(pattern, BEATS_PER_BAR, tracks[0].id, 4);
    pattern = addNote(pattern, BEATS_PER_BAR, tracks[1].id, 2);

    const events = compilePatternIteration(pattern, tracks, 120, 0);
    expect(events).toHaveLength(3);
    expect(events.filter((e) => e.sampleId === 1)).toHaveLength(2);
    expect(events.filter((e) => e.sampleId === 2)).toHaveLength(1);
  });

  it("skips notes on tracks with no assigned asset when compiling a pattern", () => {
    const tracks = createInitialTracks(1);
    let pattern: Pattern = { id: "p1", name: "Pattern A", bars: 1, notes: {} };
    pattern = addNote(pattern, BEATS_PER_BAR, tracks[0].id, 0); // no asset assigned
    expect(compilePatternIteration(pattern, tracks, 120, 0)).toHaveLength(0);
  });

  it("reflects a changed tempo in the compiled event timing", () => {
    const tracks = createInitialTracks(1).map((t) => ({ ...t, assetId: 1 }));
    let pattern: Pattern = { id: "p1", name: "Pattern A", bars: 1, notes: {} };
    pattern = addNote(pattern, BEATS_PER_BAR, tracks[0].id, 4);

    const before = compilePatternIteration(pattern, tracks, 120, 0)[0].time;
    const after = compilePatternIteration(pattern, tracks, 240, 0)[0].time; // double tempo -> half the time per beat
    expect(after).toBeCloseTo(before / 2, 5);
  });

  it("resolves each track's bus independently via busIdFor", () => {
    const tracks = createInitialTracks(2).map((t, i) => ({ ...t, assetId: i + 1 }));
    let pattern: Pattern = { id: "p1", name: "Pattern A", bars: 1, notes: {} };
    pattern = addNote(pattern, BEATS_PER_BAR, tracks[0].id, 0);
    pattern = addNote(pattern, BEATS_PER_BAR, tracks[1].id, 0);

    const busIds: Record<string, number> = { [tracks[0].id]: 1, [tracks[1].id]: 2 };
    const events = compilePatternIteration(pattern, tracks, 120, 0, (trackId) => busIds[trackId]);
    expect(events.find((e) => e.sampleId === 1)!.bus).toBe(1);
    expect(events.find((e) => e.sampleId === 2)!.bus).toBe(2);
  });
});
