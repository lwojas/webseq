import { describe, expect, it } from "vitest";
import {
  BANK_COUNT,
  BANK_SIZE,
  DEFAULT_TRACK_COUNT,
  bankOfTrackIndex,
  createEmptyPattern,
  createInitialProject,
  estimateDecodedBytes,
  sampleBudgetBytes,
  summarizeBanks,
  tracksInBank,
  withMissingTracks,
} from "../src/model/project";
import { addNote } from "../src/model/project";

describe("banks", () => {
  it("is four banks of sixteen pads, 64 tracks in all", () => {
    expect(BANK_SIZE).toBe(16);
    expect(BANK_COUNT).toBe(4);
    expect(DEFAULT_TRACK_COUNT).toBe(64);
    expect(createInitialProject().tracks).toHaveLength(64);
  });

  it("maps track indices to banks", () => {
    expect(bankOfTrackIndex(0)).toBe(0);
    expect(bankOfTrackIndex(15)).toBe(0);
    expect(bankOfTrackIndex(16)).toBe(1);
    expect(bankOfTrackIndex(63)).toBe(3);
  });

  it("slices a bank's tracks out of the flat list", () => {
    const project = createInitialProject();
    const ids = tracksInBank(project, 2).map((t) => t.id);
    expect(ids).toHaveLength(16);
    expect(ids[0]).toBe("track-33");
    expect(ids[15]).toBe("track-48");
  });
});

describe("withMissingTracks", () => {
  it("appends the tracks a 16-track project from before banks does not have", () => {
    const legacy = createInitialProject("Old", 16);
    expect(legacy.tracks).toHaveLength(16);
    const migrated = withMissingTracks(legacy);
    expect(migrated.tracks).toHaveLength(64);
    expect(new Set(migrated.tracks.map((t) => t.id)).size).toBe(64);
    expect(migrated.tracks.slice(0, 16).every((t, i) => t === legacy.tracks[i])).toBe(true);
    expect(migrated.tracks[63].id).toBe("track-64");
  });

  it("leaves a complete project untouched", () => {
    const project = createInitialProject();
    expect(withMissingTracks(project)).toBe(project);
  });
});

describe("summarizeBanks", () => {
  it("counts looping tracks and notes per bank", () => {
    let project = createInitialProject();
    const pattern = createEmptyPattern("A");
    project = { ...project, patterns: [{ ...pattern, id: "p" }] };
    project = addNote(project, "p", "track-50", 0);
    const summaries = summarizeBanks(project, project.patterns[0], ["track-17", "track-18", "track-40"]);
    expect(summaries.map((s) => s.loopCount)).toEqual([0, 2, 1, 0]);
    expect(summaries.map((s) => s.hasNotes)).toEqual([false, false, false, true]);
  });
});

describe("sample budget", () => {
  it("estimates decoded float32 memory per channel", () => {
    expect(estimateDecodedBytes({ duration: 2, sampleRate: 48000, channels: 2 })).toBe(768_000);
  });

  it("gives touch devices a smaller soft budget", () => {
    expect(sampleBudgetBytes(true)).toBeLessThan(sampleBudgetBytes(false));
  });
});
