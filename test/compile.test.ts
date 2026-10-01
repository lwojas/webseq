import { describe, expect, it } from "vitest";
import { compileNote, compilePatternIteration, secondsPerBeat, swingOffsetSeconds } from "../src/audio/compile";
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

describe("global swing timing", () => {
  // 120 BPM -> spb (one 16th) = 0.125s, used throughout as the reference duration.
  const spb = secondsPerBeat(120);
  const track: Track = { id: "track-1", assetId: 7, name: "kick.wav", fx: [], automation: [], volume: 1, muted: false, soloed: false };

  describe("swingOffsetSeconds", () => {
    it("is a no-op at 50% (straight) for both the first and second 16th of a pair", () => {
      expect(swingOffsetSeconds(0, 0.5, spb)).toBe(0);
      expect(swingOffsetSeconds(1, 0.5, spb)).toBe(0);
    });

    it("never offsets the first (even-indexed) 16th of any pair, at any swing amount", () => {
      for (const swing of [0.5, 0.6667, 0.75]) {
        expect(swingOffsetSeconds(0, swing, spb)).toBe(0);
        expect(swingOffsetSeconds(2, swing, spb)).toBe(0);
        expect(swingOffsetSeconds(4, swing, spb)).toBe(0);
      }
    });

    it("delays the second (odd-indexed) 16th of a pair at 66.67% (classic triplet swing)", () => {
      expect(swingOffsetSeconds(1, 2 / 3, spb)).toBeCloseTo(spb * (2 / 3 - 0.5), 10);
      expect(swingOffsetSeconds(3, 2 / 3, spb)).toBeCloseTo(spb * (2 / 3 - 0.5), 10);
    });

    it("delays the second 16th further at 75% (strong swing)", () => {
      const sixtySevenOffset = swingOffsetSeconds(1, 2 / 3, spb);
      const seventyFiveOffset = swingOffsetSeconds(1, 0.75, spb);
      expect(seventyFiveOffset).toBeCloseTo(spb * 0.25, 10);
      expect(seventyFiveOffset).toBeGreaterThan(sixtySevenOffset);
    });

    it("scales with the current BPM's 16th-note duration rather than a hard-coded time", () => {
      const spbSlow = secondsPerBeat(60); // half the BPM -> double the 16th duration
      expect(swingOffsetSeconds(1, 0.75, spbSlow)).toBeCloseTo(swingOffsetSeconds(1, 0.75, spb) * 2, 10);
    });
  });

  describe("compileNote with swing", () => {
    it("reproduces the existing straight timing when swing is 50% (default no-op)", () => {
      const note: Note = { id: "n", trackId: "track-1", start: 5, duration: 1, velocity: 1 };
      const straight = compileNote(track, note, 120, 0);
      const swung = compileNote(track, note, 120, 0, undefined, 0.5);
      expect(swung!.time).toBeCloseTo(straight!.time, 10);
    });

    it("leaves the first 16th of a pair exactly on the normal grid regardless of swing", () => {
      const note: Note = { id: "n", trackId: "track-1", start: 4, duration: 1, velocity: 1 }; // even -> first of its pair
      const event = compileNote(track, note, 120, 10, undefined, 0.75);
      expect(event!.time).toBeCloseTo(10 + 4 * spb, 10);
    });

    it("delays the second 16th of a pair by the swing offset, without touching duration", () => {
      const note: Note = { id: "n", trackId: "track-1", start: 5, duration: 1, velocity: 1 }; // odd -> second of its pair
      const straight = compileNote(track, note, 120, 10, undefined, 0.5)!;
      const swung = compileNote(track, note, 120, 10, undefined, 0.75)!;
      expect(swung.time).toBeCloseTo(straight.time + spb * 0.25, 10);
      expect(swung.duration).toBe(straight.duration); // swing never touches note duration
    });

    it("keeps the following pair's first 16th at its original, unswung grid boundary", () => {
      const firstOfNextPair: Note = { id: "n2", trackId: "track-1", start: 6, duration: 1, velocity: 1 };
      const event = compileNote(track, firstOfNextPair, 120, 10, undefined, 0.75);
      expect(event!.time).toBeCloseTo(10 + 6 * spb, 10); // unaffected by the previous pair's delayed off-beat
    });
  });

  describe("compilePatternIteration with swing", () => {
    it("applies swing consistently across every track in the pattern", () => {
      const tracks = createInitialTracks(2).map((t, i) => ({ ...t, assetId: i + 1 }));
      let pattern: Pattern = { id: "p1", name: "Pattern A", bars: 1, notes: {} };
      pattern = addNote(pattern, BEATS_PER_BAR, tracks[0].id, 1);
      pattern = addNote(pattern, BEATS_PER_BAR, tracks[1].id, 3);

      const events = compilePatternIteration(pattern, tracks, 120, 0, () => undefined, 0.75);
      const offset = spb * 0.25;
      expect(events.find((e) => e.sampleId === 1)!.time).toBeCloseTo(1 * spb + offset, 10);
      expect(events.find((e) => e.sampleId === 2)!.time).toBeCloseTo(3 * spb + offset, 10);
    });

    it("does not accumulate drift across repeated pattern iterations (each stepStartTime is absolute)", () => {
      const tracks = createInitialTracks(1).map((t) => ({ ...t, assetId: 1 }));
      let pattern: Pattern = { id: "p1", name: "Pattern A", bars: 1, notes: {} };
      pattern = addNote(pattern, BEATS_PER_BAR, tracks[0].id, 1); // second 16th of the first pair

      const loopDuration = BEATS_PER_BAR * spb;
      const iteration0 = compilePatternIteration(pattern, tracks, 120, 0, () => undefined, 0.75)[0].time;
      const iteration5 = compilePatternIteration(pattern, tracks, 120, 5 * loopDuration, () => undefined, 0.75)[0].time;
      expect(iteration5).toBeCloseTo(iteration0 + 5 * loopDuration, 10);
    });
  });
});
