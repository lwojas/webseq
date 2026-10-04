import { describe, expect, it } from "vitest";
import { compileNote, compilePatternIteration, compilePatternIterationTracked, secondsPerBeat, swingOffsetSeconds } from "../src/audio/compile";
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

    // ECS-52: micro-timing lets a note's start be a fractional sub-step position. The parity
    // check must key off the *containing* 16th-note index (Math.floor), not the raw fractional
    // value, or every micro-timed note in an odd pair-slot would wrongly read as "even".
    it("applies no swing to a fractional start still within an even (first-of-pair) 16th slot", () => {
      expect(swingOffsetSeconds(4.5, 0.75, spb)).toBe(0);
      expect(swingOffsetSeconds(4.9375, 0.75, spb)).toBe(0); // same slot, right up against the next boundary
    });

    it("applies the full swing offset to a fractional start within an odd (second-of-pair) 16th slot", () => {
      expect(swingOffsetSeconds(5.5, 0.75, spb)).toBeCloseTo(spb * 0.25, 10);
      expect(swingOffsetSeconds(5.0625, 0.75, spb)).toBeCloseTo(spb * 0.25, 10);
    });

    it("treats a fractional start the same as the integer start of its containing 16th slot", () => {
      expect(swingOffsetSeconds(5.9, 0.75, spb)).toBeCloseTo(swingOffsetSeconds(5, 0.75, spb), 10);
      expect(swingOffsetSeconds(4.9, 0.75, spb)).toBeCloseTo(swingOffsetSeconds(4, 0.75, spb), 10);
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

    it("applies the correct pair member's swing to a micro-timed, fractional-start note", () => {
      const note: Note = { id: "n", trackId: "track-1", start: 5.25, duration: 0.5, velocity: 1 }; // sub-step offset within the odd (5th) 16th
      const event = compileNote(track, note, 120, 10, undefined, 0.75);
      expect(event!.time).toBeCloseTo(10 + 5.25 * spb + spb * 0.25, 10);
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

// ECS-82/ECS-87: Track.playbackMode and Track.voiceMode.
describe("playback mode and voice mode", () => {
  const baseTrack: Track = { id: "track-1", assetId: 7, name: "kick.wav", fx: [], automation: [], volume: 1, muted: false, soloed: false };
  const note: Note = { id: "note-1", trackId: "track-1", start: 4, duration: 2, velocity: 1 };

  describe("compileNote: one-shot vs. loop", () => {
    it("omits `loop` for a track with no playbackMode set (default one-shot, unchanged from before)", () => {
      const event = compileNote(baseTrack, note, 120, 0);
      expect(event!.loop).toBeUndefined();
    });

    it("omits `loop` for a track explicitly set to one-shot", () => {
      const event = compileNote({ ...baseTrack, playbackMode: "one-shot" }, note, 120, 0);
      expect(event!.loop).toBeUndefined();
    });

    it("sets `loop: true` for a loop-mode track, while leaving `duration` as the note's bounded length", () => {
      const event = compileNote({ ...baseTrack, playbackMode: "loop" }, note, 120, 0);
      expect(event!.loop).toBe(true);
      expect(event!.duration).toBeCloseTo(2 * secondsPerBeat(120), 5);
    });
  });

  describe("compilePatternIteration: mono voice truncation", () => {
    const spb = secondsPerBeat(120);
    // Two notes on one track: unswung, note A (start 5, duration 1) ends exactly where note B
    // (start 6) begins — zero gap, allowed by notes.ts's non-overlap invariant. But A sits on
    // an odd (second-of-pair) 16th, so at 75% swing it gets delayed forward by 0.25*spb while
    // B (even, first-of-pair) doesn't move — producing a genuine overlap once swing is applied
    // (an odd-duration note is required so A and B land in different-parity slots; an even
    // duration would shift both identically and never create an overlap to begin with). This
    // is the swing-vs-grid-invariant edge case mono truncation exists for (see
    // compilePatternIterationTracked's doc comment).
    const pattern: Pattern = {
      id: "p1",
      name: "Pattern A",
      bars: 1,
      notes: {
        a: { id: "a", trackId: "track-1", start: 5, duration: 1, velocity: 1 },
        b: { id: "b", trackId: "track-1", start: 6, duration: 2, velocity: 1 },
      },
    };

    it("leaves durations untouched for a poly track, even where swing creates an overlap", () => {
      const tracks = [{ ...baseTrack, voiceMode: "poly" as const }];
      const events = compilePatternIteration(pattern, tracks, 120, 0, () => undefined, 0.75);
      expect(events[0].duration).toBeCloseTo(1 * spb, 10);
      expect(events[1].duration).toBeCloseTo(2 * spb, 10);
      // The overlap really is there for poly: A's end is after B's start.
      expect(events[0].time + events[0].duration!).toBeGreaterThan(events[1].time);
    });

    it("truncates the earlier note's duration for a mono track so it never overlaps the next", () => {
      const tracks = [{ ...baseTrack, voiceMode: "mono" as const }];
      const events = compilePatternIteration(pattern, tracks, 120, 0, () => undefined, 0.75);
      expect(events[0].time + events[0].duration!).toBeCloseTo(events[1].time, 10);
      expect(events[0].duration!).toBeLessThan(1 * spb);
      // The last note on a mono track has no following note to truncate against.
      expect(events[1].duration).toBeCloseTo(2 * spb, 10);
    });

    it("never extends a note's duration, only shortens it", () => {
      const roomyPattern: Pattern = {
        id: "p2",
        name: "Pattern B",
        bars: 1,
        notes: {
          a: { id: "a", trackId: "track-1", start: 0, duration: 1, velocity: 1 },
          b: { id: "b", trackId: "track-1", start: 8, duration: 1, velocity: 1 },
        },
      };
      const tracks = [{ ...baseTrack, voiceMode: "mono" as const }];
      const events = compilePatternIteration(roomyPattern, tracks, 120, 0, () => undefined, 0.5);
      expect(events[0].duration).toBeCloseTo(1 * spb, 10); // plenty of room; untouched
    });
  });

  describe("compilePatternIterationTracked", () => {
    it("pairs each compiled event with the TrackId that produced it", () => {
      const tracks = createInitialTracks(2).map((t, i) => ({ ...t, assetId: i + 1 }));
      let pattern: Pattern = { id: "p1", name: "Pattern A", bars: 1, notes: {} };
      pattern = addNote(pattern, BEATS_PER_BAR, tracks[0].id, 0);
      pattern = addNote(pattern, BEATS_PER_BAR, tracks[1].id, 2);

      const results = compilePatternIterationTracked(pattern, tracks, 120, 0);
      expect(results.find((r) => r.event.sampleId === 1)!.trackId).toBe(tracks[0].id);
      expect(results.find((r) => r.event.sampleId === 2)!.trackId).toBe(tracks[1].id);
    });
  });
});
