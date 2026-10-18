import { describe, expect, it } from "vitest";
import { syncBuses } from "../src/audio/busSync";
import { compileNote } from "../src/audio/compile";
import { addCue, assetLengthFrames, cueRegions, evenCues, moveCue, normalizeCues, removeCue, MIN_SLICE } from "../src/model/chop";
import { addAsset, createInitialProject, setAssetCues, setTrackSampleMode } from "../src/model/project";
import type { Asset, Note, Track } from "../src/model/types";
import { mockRuntime } from "./mockRuntime";

const track: Track = { id: "track-1", assetId: 7, name: "x", fx: [], automation: [], volume: 1, muted: false, soloed: false };
const note = (pitch?: number): Note => ({ id: "n", trackId: "track-1", start: 0, duration: 1, velocity: 1, ...(pitch ? { pitch } : {}) });
const asset: Asset = { id: 7, name: "x", type: "audio", duration: 2, sampleRate: 48000, channels: 1, origin: "import" };

describe("cue model", () => {
  it("makes N equal slices from N-1 cues and converts to frame regions", () => {
    expect(evenCues(4)).toEqual([0.25, 0.5, 0.75]);
    expect(evenCues(1)).toEqual([]);
    expect(cueRegions([0.5], 100)).toEqual([{ start: 0, end: 50 }, { start: 50, end: 100 }]);
    expect(assetLengthFrames(asset)).toBe(96000);
  });
  it("normalises, adds, moves (never crossing neighbours) and removes cues", () => {
    expect(normalizeCues([0.6, 0.2, 0.2, 1.5, -1, NaN])).toEqual([0.2, 0.6]);
    expect(addCue([0.5], 0.5 + MIN_SLICE / 2)).toEqual([0.5]);
    expect(addCue([0.5], 0.25)).toEqual([0.25, 0.5]);
    expect(moveCue([0.25, 0.5], 0, 0.9)[0]).toBeCloseTo(0.5 - MIN_SLICE, 6);
    expect(moveCue([0.25, 0.5], 1, 0.1)[1]).toBeCloseTo(0.25 + MIN_SLICE, 6);
    expect(removeCue([0.25, 0.5], 0)).toEqual([0.5]);
  });
});

describe("compiling chop notes", () => {
  it("leaves a chromatic track unchanged: pitch transposes, no region", () => {
    const e = compileNote(track, note(3), 120, 0)!;
    expect(e.pitch).toBe(3);
    expect(e.region).toBeUndefined();
  });
  it("uses the note's pitch as the slice index in chop mode and never transposes", () => {
    const chop = { ...track, sampleMode: "chop" as const };
    expect(compileNote(chop, note(), 120, 0)!.region).toBe(0);
    const e = compileNote(chop, note(5), 120, 0)!;
    expect(e.region).toBe(5);
    expect(e.pitch).toBeUndefined();
    expect(compileNote(chop, note(-1), 120, 0)).toBeNull();
  });
});

describe("project actions and engine sync", () => {
  it("stores normalised cues on the asset and drops the field when empty", () => {
    let p = addAsset(createInitialProject(), asset);
    p = setAssetCues(p, 7, [0.5, 0.25]);
    expect(p.assets[0].cues).toEqual([0.25, 0.5]);
    p = setAssetCues(p, 7, []);
    expect(p.assets[0].cues).toBeUndefined();
    expect(setTrackSampleMode(p, "track-1", "chop").tracks[0].sampleMode).toBe("chop");
  });
  it("pushes frame regions only when an asset's cues change", () => {
    const { runtime, calls } = mockRuntime();
    const buses = {};
    let p = addAsset(createInitialProject(), asset);
    syncBuses(runtime, p, buses);
    expect(calls.setSampleRegions).toHaveLength(0);
    p = setAssetCues(p, 7, [0.5]);
    syncBuses(runtime, p, buses);
    syncBuses(runtime, p, buses);
    expect(calls.setSampleRegions).toEqual([[7, [{ start: 0, end: 48000 }, { start: 48000, end: 96000 }]]]);
    p = setAssetCues(p, 7, []);
    syncBuses(runtime, p, buses);
    expect(calls.setSampleRegions[1]).toEqual([7, []]);
  });
});
