import { describe, expect, it } from "vitest";
import {
  addAsset,
  addPattern,
  assignAsset,
  createInitialProject,
  duplicatePattern,
  queuePatternNext,
  removeAsset,
  removePattern,
  removePatternFromQueue,
  renameAsset,
  setBpm,
  setSwing,
  setPatternBars,
  setTrackMuted,
  setTrackPlaybackMode,
  setTrackSoloed,
  setTrackVoiceMode,
  setTrackVolume,
} from "../src/model/project";
import { addNote, clearTrackNotes, moveNote, pasteNotes, removeNote, remapAssetIds, resizeNote } from "../src/model/project";
import type { Asset } from "../src/model/types";
import { effectivePlaybackMode, effectiveTrackGain, effectiveVoiceMode, notesForTrack, patternById, resolveChainStep, totalBeats } from "../src/model/types";

function makeAsset(overrides: Partial<Asset> & Pick<Asset, "id" | "name">): Asset {
  return { type: "audio", duration: 1, sampleRate: 48000, channels: 2, origin: "import", ...overrides };
}

describe("project model", () => {
  it("creates 64 tracks (four banks of 16) and a single 1-bar pattern with a one-entry chain by default", () => {
    const project = createInitialProject();
    expect(project.tracks).toHaveLength(64);
    expect(project.beatsPerBar).toBe(16);
    expect(project.patterns).toHaveLength(1);
    expect(project.patternChain).toHaveLength(1);
    expect(project.patternChain[0].patternId).toBe(project.patterns[0].id);
  });

  it("clamps BPM to the 40-240 range and applies it project-wide", () => {
    let project = setBpm(createInitialProject(), 999);
    expect(project.bpm).toBe(240);
    project = setBpm(project, -10);
    expect(project.bpm).toBe(40);
  });

  it("defaults swing to 50% (straight) and clamps it to the 50-75% range", () => {
    expect(createInitialProject().swing).toBe(0.5);
    let project = setSwing(createInitialProject(), 0.9);
    expect(project.swing).toBe(0.75);
    project = setSwing(project, 0.1);
    expect(project.swing).toBe(0.5);
  });

  it("adds an asset to the bin without assigning it to any track", () => {
    const asset = makeAsset({ id: 42, name: "kick.wav" });
    const project = addAsset(createInitialProject(), asset);
    expect(project.assets).toContainEqual(asset);
    expect(project.tracks.every((t) => t.assetId === null)).toBe(true);
  });

  it("assigns an asset to a track and updates the track's display name", () => {
    let project = addAsset(createInitialProject(), makeAsset({ id: 42, name: "kick.wav" }));
    project = assignAsset(project, "track-3", 42);
    const track = project.tracks.find((t) => t.id === "track-3")!;
    expect(track.assetId).toBe(42);
    expect(track.name).toBe("kick.wav");
  });

  it("assigning an unknown asset id is a no-op", () => {
    const project = createInitialProject();
    expect(assignAsset(project, "track-1", 999)).toEqual(project);
  });

  it("the same asset can be assigned to multiple tracks", () => {
    let project = addAsset(createInitialProject(), makeAsset({ id: 1, name: "kick.wav" }));
    project = assignAsset(project, "track-1", 1);
    project = assignAsset(project, "track-2", 1);
    expect(project.tracks.find((t) => t.id === "track-1")!.assetId).toBe(1);
    expect(project.tracks.find((t) => t.id === "track-2")!.assetId).toBe(1);
    expect(project.assets).toHaveLength(1);
  });

  it("renames an asset in the bin", () => {
    let project = addAsset(createInitialProject(), makeAsset({ id: 1, name: "kick.wav" }));
    project = renameAsset(project, 1, "Kick (renamed)");
    expect(project.assets[0].name).toBe("Kick (renamed)");
  });

  it("removing an asset drops it from the bin and clears every track that referenced it", () => {
    let project = addAsset(createInitialProject(), makeAsset({ id: 1, name: "kick.wav" }));
    project = assignAsset(project, "track-1", 1);
    project = assignAsset(project, "track-2", 1);

    project = removeAsset(project, 1);
    expect(project.assets).toHaveLength(0);
    expect(project.tracks.find((t) => t.id === "track-1")!.assetId).toBeNull();
    expect(project.tracks.find((t) => t.id === "track-2")!.assetId).toBeNull();
  });

  it("records origin/sourcePatternId metadata for a resampled asset", () => {
    const asset = makeAsset({ id: 5, name: "Resample 01", origin: "resample", sourcePatternId: "pattern-b" });
    const project = addAsset(createInitialProject(), asset);
    expect(project.assets[0].origin).toBe("resample");
    expect(project.assets[0].sourcePatternId).toBe("pattern-b");
  });

  it("adds notes to a specific pattern without affecting other patterns", () => {
    let project = createInitialProject();
    project = addPattern(project, "Pattern B", 2);
    const [patternA, patternB] = project.patterns;

    project = addNote(project, patternA.id, "track-1", 0);
    expect(notesForTrack(patternById(project, patternA.id)!, "track-1")).toHaveLength(1);
    expect(notesForTrack(patternById(project, patternB.id)!, "track-1")).toHaveLength(0);
  });

  it("edits notes (remove/resize/move) scoped to the correct pattern", () => {
    let project = createInitialProject();
    const patternId = project.patterns[0].id;
    project = addNote(project, patternId, "track-1", 0);
    let note = notesForTrack(patternById(project, patternId)!, "track-1")[0];

    project = resizeNote(project, patternId, note.id, 4);
    note = patternById(project, patternId)!.notes[note.id];
    expect(note.duration).toBe(4);

    project = moveNote(project, patternId, note.id, 8);
    note = patternById(project, patternId)!.notes[note.id];
    expect(note.start).toBe(8);

    project = removeNote(project, patternId, note.id);
    expect(notesForTrack(patternById(project, patternId)!, "track-1")).toHaveLength(0);
  });

  it("supports patterns with different bar lengths", () => {
    let project = createInitialProject();
    const patternA = project.patterns[0].id;
    project = addPattern(project, "Pattern B", 2);
    project = addPattern(project, "Pattern C", 4);
    project = setPatternBars(project, patternA, 1);

    expect(project.patterns.map((p) => totalBeats(p, project.beatsPerBar))).toEqual([16, 32, 64]);
  });

  it("duplicating a pattern copies its notes independently", () => {
    let project = createInitialProject();
    const patternId = project.patterns[0].id;
    project = addNote(project, patternId, "track-1", 0);
    project = duplicatePattern(project, patternId);
    const copy = project.patterns[1];

    project = removeNote(project, patternId, notesForTrack(patternById(project, patternId)!, "track-1")[0].id);
    expect(notesForTrack(patternById(project, patternId)!, "track-1")).toHaveLength(0);
    expect(notesForTrack(copy, "track-1")).toHaveLength(1); // unaffected by the original's edit
  });

  it("refuses to remove the last remaining pattern", () => {
    const project = createInitialProject();
    const result = removePattern(project, project.patterns[0].id);
    expect(result.patterns).toHaveLength(1);
  });

  // ECS-107: whole-track clear is bounded to one track, in one pattern — everything else
  // (other patterns' same-track notes, other tracks, assets, track config) is untouched.
  it("clearTrackNotes only clears the target track within the target pattern", () => {
    let project = createInitialProject();
    const patternA = project.patterns[0].id;
    project = addPattern(project, "Pattern B", 1);
    const patternB = project.patterns[1].id;
    project = addNote(project, patternA, "track-1", 0);
    project = addNote(project, patternA, "track-2", 0);
    project = addNote(project, patternB, "track-1", 0);
    project = addAsset(project, makeAsset({ id: 1, name: "Kick" }));
    project = assignAsset(project, "track-1", 1);

    project = clearTrackNotes(project, patternA, "track-1");

    expect(notesForTrack(patternById(project, patternA)!, "track-1")).toHaveLength(0);
    expect(notesForTrack(patternById(project, patternA)!, "track-2")).toHaveLength(1); // other track, same pattern
    expect(notesForTrack(patternById(project, patternB)!, "track-1")).toHaveLength(1); // same track, other pattern
    expect(project.tracks.find((t) => t.id === "track-1")?.assetId).toBe(1); // track config untouched
  });

  it("clearTrackNotes is a no-op when the track already has no notes in that pattern", () => {
    const project = createInitialProject();
    const patternId = project.patterns[0].id;
    const result = clearTrackNotes(project, patternId, "track-1");
    expect(patternById(result, patternId)).toBe(patternById(project, patternId));
  });

  // ECS-112: paste can target a different track AND a different pattern than it was copied
  // from; pasted positions are unchanged, and unrelated patterns/tracks/assets are untouched.
  it("pasteNotes copies a track's notes onto another track, in a different pattern, unchanged positions", () => {
    let project = createInitialProject();
    const patternA = project.patterns[0].id;
    project = addPattern(project, "Pattern B", 1);
    const patternB = project.patterns[1].id;
    project = addNote(project, patternA, "track-1", 0);
    project = addNote(project, patternA, "track-1", 4);
    const copied = notesForTrack(patternById(project, patternA)!, "track-1").map((n) => ({
      start: n.start,
      duration: n.duration,
      velocity: n.velocity,
    }));

    const result = pasteNotes(project, patternB, "track-2", copied);
    expect(result.pasted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(notesForTrack(patternById(result.project, patternB)!, "track-2").map((n) => n.start).sort((a, b) => a - b)).toEqual([0, 4]);
    expect(notesForTrack(patternById(result.project, patternA)!, "track-1")).toHaveLength(2); // source untouched
    expect(notesForTrack(patternById(result.project, patternB)!, "track-1")).toHaveLength(0); // other track in dest pattern untouched
  });

  it("pasteNotes reports partial success when some copied notes don't fit", () => {
    let project = createInitialProject();
    const patternId = project.patterns[0].id;
    project = addNote(project, patternId, "track-2", 0); // occupies [0, 1) on the destination track

    const result = pasteNotes(project, patternId, "track-2", [
      { start: 0, duration: 1, velocity: 1 }, // collides
      { start: 4, duration: 1, velocity: 1 }, // fits
    ]);
    expect(result.pasted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(notesForTrack(patternById(result.project, patternId)!, "track-2")).toHaveLength(2); // original + the one that fit
  });

  it("removing a pattern also removes it from the queue", () => {
    let project = createInitialProject();
    const patternA = project.patterns[0].id;
    project = addPattern(project, "Pattern B");
    const patternB = project.patterns[1].id;
    project = queuePatternNext(project, patternB, project.patternChain[0].id);
    project = queuePatternNext(project, patternA, project.patternChain[0].id);

    project = removePattern(project, patternA);
    expect(project.patternChain.every((e) => e.patternId !== patternA)).toBe(true);
  });

  it("removing a pattern that was the queue's only entry falls back to the first remaining pattern, never leaving it empty", () => {
    let project = createInitialProject();
    const a = project.patterns[0].id;
    project = addPattern(project, "Pattern B"); // B exists but was never queued
    const b = project.patterns[1].id;

    project = removePattern(project, a); // queue was [A] only
    expect(project.patternChain).toHaveLength(1);
    expect(project.patternChain[0].patternId).toBe(b);
  });

  it("queuePatternNext inserts right after the given entry, not at the end", () => {
    let project = createInitialProject();
    const a = project.patterns[0].id; // queue starts as [A]
    project = addPattern(project, "Pattern B");
    const b = project.patterns[1].id;
    project = addPattern(project, "Pattern C");
    const c = project.patterns[2].id;

    project = queuePatternNext(project, c, project.patternChain[0].id); // [A, C]
    const afterA = project.patternChain[0].id;
    project = queuePatternNext(project, b, afterA); // insert after A again -> [A, B, C]

    expect(project.patternChain.map((e) => e.patternId)).toEqual([a, b, c]);
  });

  it("queuePatternNext appends when afterEntryId is null or no longer present", () => {
    let project = createInitialProject();
    const a = project.patterns[0].id;
    project = addPattern(project, "Pattern B");
    const b = project.patterns[1].id;

    project = queuePatternNext(project, b, null);
    expect(project.patternChain.map((e) => e.patternId)).toEqual([a, b]);

    project = addPattern(project, "Pattern C");
    const c = project.patterns[2].id;
    project = queuePatternNext(project, c, "no-such-entry-id");
    expect(project.patternChain.map((e) => e.patternId)).toEqual([a, b, c]);
  });

  it("removePatternFromQueue removes every entry for that pattern, but refuses to empty the queue", () => {
    let project = createInitialProject();
    const a = project.patterns[0].id;
    project = addPattern(project, "Pattern B");
    const b = project.patterns[1].id;
    project = queuePatternNext(project, b, project.patternChain[0].id); // [A, B]
    project = queuePatternNext(project, a, project.patternChain[0].id); // [A, A, B] -- A appears twice

    project = removePatternFromQueue(project, a);
    expect(project.patternChain.map((e) => e.patternId)).toEqual([b]); // both A entries gone

    const unchanged = removePatternFromQueue(project, b); // only entry left -- refused
    expect(unchanged.patternChain.map((e) => e.patternId)).toEqual([b]);
  });

  it("resolveChainStep wraps around the queue length and skips dangling entries", () => {
    let project = createInitialProject();
    const a = project.patterns[0].id;
    project = addPattern(project, "Pattern B");
    const b = project.patterns[1].id;
    project = queuePatternNext(project, b, project.patternChain[0].id); // queue: [A, B]

    expect(resolveChainStep(project, 0)?.pattern.id).toBe(a);
    expect(resolveChainStep(project, 1)?.pattern.id).toBe(b);
    expect(resolveChainStep(project, 2)?.pattern.id).toBe(a); // wraps
    expect(resolveChainStep(project, 3)?.pattern.id).toBe(b);
  });

  it("resolveChainStep returns null for an empty chain", () => {
    const project = { ...createInitialProject(), patternChain: [] };
    expect(resolveChainStep(project, 0)).toBeNull();
  });

  it("remaps asset ids across tracks and the asset bin after a reload", () => {
    let project = addAsset(createInitialProject(), makeAsset({ id: 7, name: "kick.wav" }));
    project = addAsset(project, makeAsset({ id: 9, name: "snare.wav" }));
    project = assignAsset(project, "track-1", 7);
    project = assignAsset(project, "track-2", 9);

    const idMap = new Map([
      [7, 107],
      [9, 109],
    ]);
    project = remapAssetIds(project, idMap);

    expect(project.tracks.find((t) => t.id === "track-1")!.assetId).toBe(107);
    expect(project.tracks.find((t) => t.id === "track-2")!.assetId).toBe(109);
    expect(project.assets.map((a) => a.id).sort()).toEqual([107, 109]);
  });

  it("a project's assets and track references survive a persistence-shaped round trip", () => {
    // Mirrors what saveProject/loadProject actually persist: the plain Project JSON (assets +
    // track references) is what's expected to serialize losslessly; the binary bytes
    // themselves live in a separate IndexedDB store (see persistence/projectStore.ts).
    let project = addAsset(createInitialProject(), makeAsset({ id: 1, name: "kick.wav" }));
    project = addAsset(project, makeAsset({ id: 2, name: "Resample 01", origin: "resample", sourcePatternId: project.patterns[0].id }));
    project = assignAsset(project, "track-1", 1);
    project = assignAsset(project, "track-2", 2);

    const roundTripped: typeof project = JSON.parse(JSON.stringify(project));
    expect(roundTripped.assets).toEqual(project.assets);
    expect(roundTripped.tracks.find((t) => t.id === "track-1")!.assetId).toBe(1);
    expect(roundTripped.tracks.find((t) => t.id === "track-2")!.assetId).toBe(2);
  });

  it("defaults every track to unity volume, unmuted, unsoloed", () => {
    const project = createInitialProject();
    expect(project.tracks.every((t) => t.volume === 1 && t.muted === false && t.soloed === false)).toBe(true);
  });

  it("sets a track's volume, clamped to the 0..1.5 range, without affecting other tracks", () => {
    let project = setTrackVolume(createInitialProject(), "track-1", 0.5);
    expect(project.tracks.find((t) => t.id === "track-1")!.volume).toBe(0.5);
    expect(project.tracks.find((t) => t.id === "track-2")!.volume).toBe(1);

    project = setTrackVolume(project, "track-1", 99);
    expect(project.tracks.find((t) => t.id === "track-1")!.volume).toBe(1.5);
    project = setTrackVolume(project, "track-1", -5);
    expect(project.tracks.find((t) => t.id === "track-1")!.volume).toBe(0);
  });

  it("mutes and unmutes a track independently of its volume", () => {
    let project = setTrackVolume(createInitialProject(), "track-1", 0.8);
    project = setTrackMuted(project, "track-1", true);
    expect(project.tracks.find((t) => t.id === "track-1")!.muted).toBe(true);
    expect(project.tracks.find((t) => t.id === "track-1")!.volume).toBe(0.8);
  });

  it("effectiveTrackGain: a muted track is silent regardless of volume", () => {
    let project = setTrackVolume(createInitialProject(), "track-1", 1.2);
    project = setTrackMuted(project, "track-1", true);
    const track = project.tracks.find((t) => t.id === "track-1")!;
    expect(effectiveTrackGain(project, track)).toBe(0);
  });

  it("effectiveTrackGain: soloing a track silences every other non-soloed track", () => {
    let project = setTrackSoloed(createInitialProject(), "track-2", true);
    const soloed = project.tracks.find((t) => t.id === "track-2")!;
    const other = project.tracks.find((t) => t.id === "track-1")!;
    expect(effectiveTrackGain(project, soloed)).toBe(1);
    expect(effectiveTrackGain(project, other)).toBe(0);
  });

  it("effectiveTrackGain: multiple soloed tracks all stay audible", () => {
    let project = setTrackSoloed(createInitialProject(), "track-1", true);
    project = setTrackSoloed(project, "track-2", true);
    const t1 = project.tracks.find((t) => t.id === "track-1")!;
    const t2 = project.tracks.find((t) => t.id === "track-2")!;
    expect(effectiveTrackGain(project, t1)).toBe(1);
    expect(effectiveTrackGain(project, t2)).toBe(1);
  });

  it("effectiveTrackGain: with nothing soloed, every unmuted track plays at its own volume", () => {
    const project = setTrackVolume(createInitialProject(), "track-1", 0.3);
    const track = project.tracks.find((t) => t.id === "track-1")!;
    expect(effectiveTrackGain(project, track)).toBe(0.3);
  });

  // ECS-82/ECS-87
  describe("playback mode / voice mode", () => {
    it("defaults every track to one-shot and poly", () => {
      const project = createInitialProject();
      expect(project.tracks.every((t) => effectivePlaybackMode(t) === "one-shot")).toBe(true);
      expect(project.tracks.every((t) => effectiveVoiceMode(t) === "poly")).toBe(true);
    });

    it("effectivePlaybackMode/effectiveVoiceMode default a field-less track the same way, for old saved projects with no migration step", () => {
      const legacyTrack = { ...createInitialProject().tracks[0] };
      delete (legacyTrack as { playbackMode?: unknown }).playbackMode;
      delete (legacyTrack as { voiceMode?: unknown }).voiceMode;
      expect(effectivePlaybackMode(legacyTrack)).toBe("one-shot");
      expect(effectiveVoiceMode(legacyTrack)).toBe("poly");
    });

    it("sets a track's playback mode without affecting other tracks", () => {
      let project = setTrackPlaybackMode(createInitialProject(), "track-1", "loop");
      expect(project.tracks.find((t) => t.id === "track-1")!.playbackMode).toBe("loop");
      expect(project.tracks.find((t) => t.id === "track-2")!.playbackMode).toBe("one-shot");

      project = setTrackPlaybackMode(project, "track-1", "one-shot");
      expect(project.tracks.find((t) => t.id === "track-1")!.playbackMode).toBe("one-shot");
    });

    it("sets a track's voice mode without affecting other tracks", () => {
      let project = setTrackVoiceMode(createInitialProject(), "track-1", "mono");
      expect(project.tracks.find((t) => t.id === "track-1")!.voiceMode).toBe("mono");
      expect(project.tracks.find((t) => t.id === "track-2")!.voiceMode).toBe("poly");

      project = setTrackVoiceMode(project, "track-1", "poly");
      expect(project.tracks.find((t) => t.id === "track-1")!.voiceMode).toBe("poly");
    });
  });
});
