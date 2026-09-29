import { describe, expect, it } from "vitest";
import { addFx, removeFx, setFxEnabled, setFxParam } from "../src/model/fx";
import { createInitialProject } from "../src/model/project";

describe("FX chains (track and master)", () => {
  it("adds an FX to a track with default parameters", () => {
    const project = addFx(createInitialProject(), "track-1", "filter");
    const track = project.tracks.find((t) => t.id === "track-1")!;
    expect(track.fx).toHaveLength(1);
    expect(track.fx[0].type).toBe("filter");
    expect(track.fx[0].enabled).toBe(true);
  });

  it("supports multiple different FX on the same track, in order", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    project = addFx(project, "track-1", "delay");
    const track = project.tracks.find((t) => t.id === "track-1")!;
    expect(track.fx.map((f) => f.type)).toEqual(["filter", "delay"]);
  });

  it("does not add a second FX of the same type to one track (engine has one filter/delay slot per bus)", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    project = addFx(project, "track-1", "filter");
    const track = project.tracks.find((t) => t.id === "track-1")!;
    expect(track.fx).toHaveLength(1);
  });

  it("keeps track FX independent of another track's FX", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const track2 = project.tracks.find((t) => t.id === "track-2")!;
    expect(track2.fx).toHaveLength(0);
  });

  it("supports master FX independently of any track", () => {
    const project = addFx(createInitialProject(), "master", "delay");
    expect(project.master.fx).toHaveLength(1);
    expect(project.tracks.every((t) => t.fx.length === 0)).toBe(true);
  });

  it("updates a parameter on a specific FX instance", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const fxId = project.tracks[0].fx[0].id;
    project = setFxParam(project, "track-1", fxId, "cutoff", 800);
    expect(project.tracks[0].fx[0].params.cutoff).toBe(800);
  });

  it("toggles bypass state on an FX", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const fxId = project.tracks[0].fx[0].id;
    project = setFxEnabled(project, "track-1", fxId, false);
    expect(project.tracks[0].fx[0].enabled).toBe(false);
  });

  it("removing an FX also removes its automation lanes", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const fxId = project.tracks[0].fx[0].id;
    project = {
      ...project,
      tracks: project.tracks.map((t, i) =>
        i === 0 ? { ...t, automation: [{ fxId, parameter: "cutoff", events: [{ position: 0, value: 500 }] }] } : t,
      ),
    };
    project = removeFx(project, "track-1", fxId);
    expect(project.tracks[0].fx).toHaveLength(0);
    expect(project.tracks[0].automation).toHaveLength(0);
  });
});
