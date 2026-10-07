import { describe, expect, it } from "vitest";
import { addFx } from "../src/model/fx";
import { setAutomationPoint } from "../src/model/automation";
import { addAsset, assignAsset, createInitialProject, setTrackPlaybackMode, setTrackVoiceMode } from "../src/model/project";
import { copyTrackConfig, hasTrackConfig, pasteTrackConfig } from "../src/model/trackConfig";
import type { Asset } from "../src/model/types";

function makeAsset(overrides: Partial<Asset> & Pick<Asset, "id" | "name">): Asset {
  return { type: "audio", duration: 1, sampleRate: 48000, channels: 2, origin: "import", ...overrides };
}

describe("hasTrackConfig", () => {
  it("is false for a freshly created, unconfigured track", () => {
    const project = createInitialProject();
    expect(hasTrackConfig(project.tracks[0])).toBe(false);
  });

  it("is true once any one of asset/fx/automation/playbackMode/voiceMode is set", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    expect(hasTrackConfig(project.tracks[0])).toBe(true);

    project = setTrackVoiceMode(createInitialProject(), "track-1", "mono");
    expect(hasTrackConfig(project.tracks[0])).toBe(true);
  });
});

describe("copyTrackConfig / pasteTrackConfig", () => {
  it("copies asset/FX/automation/playback/voice mode onto another track, regenerating FX ids", () => {
    let project = addAsset(createInitialProject(), makeAsset({ id: 1, name: "kick.wav" }));
    project = assignAsset(project, "track-1", 1);
    project = addFx(project, "track-1", "filter");
    const sourceFxId = project.tracks[0].fx[0].id;
    project = setAutomationPoint(project, "track-1", sourceFxId, "cutoff", 0, 500);
    project = setTrackPlaybackMode(project, "track-1", "loop");
    project = setTrackVoiceMode(project, "track-1", "mono");

    const config = copyTrackConfig(project.tracks[0]);
    project = pasteTrackConfig(project, "track-2", config);
    const dest = project.tracks[1];

    expect(dest.assetId).toBe(1);
    expect(dest.name).toBe("kick.wav"); // matches assignAsset's own renaming rule
    expect(dest.fx).toHaveLength(1);
    expect(dest.fx[0].type).toBe("filter");
    expect(dest.fx[0].id).not.toBe(sourceFxId); // fresh id, never shared with the source
    expect(dest.automation).toHaveLength(1);
    expect(dest.automation[0].fxId).toBe(dest.fx[0].id); // remapped to the new id, not the copied one
    expect(dest.playbackMode).toBe("loop");
    expect(dest.voiceMode).toBe("mono");
  });

  it("leaves destination id, volume, muted and soloed untouched", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const config = copyTrackConfig(project.tracks[0]);
    project = pasteTrackConfig(project, "track-2", config);
    const dest = project.tracks[1];

    expect(dest.id).toBe("track-2");
    expect(dest.volume).toBe(project.tracks[0].volume); // default, unmodified
    expect(dest.muted).toBe(false);
    expect(dest.soloed).toBe(false);
  });

  it("replaces the destination's existing FX/automation atomically rather than merging", () => {
    let project = addFx(createInitialProject(), "track-1", "filter"); // source: filter only
    let destProject = addFx(createInitialProject(), "track-2", "delay"); // dest already has a delay
    // Simulate the two living in the same project.
    project = { ...project, tracks: project.tracks.map((t) => (t.id === "track-2" ? destProject.tracks[1] : t)) };
    expect(project.tracks[1].fx[0].type).toBe("delay");

    const config = copyTrackConfig(project.tracks[0]);
    project = pasteTrackConfig(project, "track-2", config);

    // The destination's old delay is gone -- a merge would have tried to keep both.
    expect(project.tracks[1].fx.map((f) => f.type)).toEqual(["filter"]);
  });

  it("does not mutate the source track's FX/automation when the destination is edited later", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const fxId = project.tracks[0].fx[0].id;
    project = setAutomationPoint(project, "track-1", fxId, "cutoff", 0, 500);

    const config = copyTrackConfig(project.tracks[0]);
    project = pasteTrackConfig(project, "track-2", config);
    // Mutate what paste wrote for track-2's clone in place, as if some other code held a
    // reference to it -- the source track's own objects must be distinct instances.
    project.tracks[1].fx[0].params.cutoff = 999;
    project.tracks[1].automation[0].events[0].value = 999;

    expect(project.tracks[0].fx[0].params.cutoff).not.toBe(999);
    expect(project.tracks[0].automation[0].events[0].value).not.toBe(999);
  });

  it("falls back to an unassigned track when the copied asset no longer exists in the project", () => {
    let project = addAsset(createInitialProject(), makeAsset({ id: 1, name: "kick.wav" }));
    project = assignAsset(project, "track-1", 1);
    const config = copyTrackConfig(project.tracks[0]);

    // The asset is removed from the project before paste happens.
    project = { ...project, assets: [] };
    project = pasteTrackConfig(project, "track-2", config);

    expect(project.tracks[1].assetId).toBeNull();
  });

  it("does not rename the destination when the copied track has no asset assigned", () => {
    const project = createInitialProject();
    const config = copyTrackConfig(project.tracks[0]); // assetId null
    const originalName = project.tracks[1].name;
    const result = pasteTrackConfig(project, "track-2", config);

    expect(result.tracks[1].assetId).toBeNull();
    expect(result.tracks[1].name).toBe(originalName); // untouched, same as removeAsset's own rule
  });

  it("resets playback/voice mode to the source's (default) value, replacing a non-default destination", () => {
    // createInitialTracks already populates every track with the default mode explicitly
    // (project.ts) -- so "the source never set them" means "source is at the default", and
    // paste must still overwrite a destination that was deliberately changed away from it.
    let project = setTrackPlaybackMode(createInitialProject(), "track-2", "loop");
    project = setTrackVoiceMode(project, "track-2", "mono");
    const config = copyTrackConfig(project.tracks[0]); // track-1: left at the default

    const result = pasteTrackConfig(project, "track-2", config);
    expect(result.tracks[1].playbackMode).toBe("one-shot");
    expect(result.tracks[1].voiceMode).toBe("poly");
  });
});
