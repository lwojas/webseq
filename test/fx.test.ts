import { describe, expect, it } from "vitest";
import { MAX_FX_PER_CHAIN, addFx, moveFx, removeFx, setFxEnabled, setFxParam } from "../src/model/fx";
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
    project = addFx(project, "track-1", "chorusFlanger");
    project = addFx(project, "track-1", "delay");
    project = addFx(project, "track-1", "reverb");
    project = addFx(project, "track-1", "compressor");
    project = addFx(project, "track-1", "saturation");
    const track = project.tracks.find((t) => t.id === "track-1")!;
    expect(track.fx.map((f) => f.type)).toEqual(["filter", "chorusFlanger", "delay", "reverb", "compressor", "saturation"]);
  });

  it("stacks the same FX type more than once on one track", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    project = addFx(project, "track-1", "filter");
    const track = project.tracks.find((t) => t.id === "track-1")!;
    expect(track.fx.map((f) => f.type)).toEqual(["filter", "filter"]);
    expect(track.fx[0].id).not.toBe(track.fx[1].id);
  });

  it("caps a chain at the engine's per-bus limit", () => {
    let project = createInitialProject();
    for (let i = 0; i < MAX_FX_PER_CHAIN + 3; i++) project = addFx(project, "track-1", "delay");
    expect(project.tracks[0].fx).toHaveLength(MAX_FX_PER_CHAIN);
  });

  it("moves an FX within its chain, clamping the index", () => {
    let project = createInitialProject();
    for (const t of ["filter", "delay", "reverb"] as const) project = addFx(project, "track-1", t);
    const [filter, delay, reverb] = project.tracks[0].fx;
    project = moveFx(project, "track-1", reverb.id, 0);
    expect(project.tracks[0].fx.map((f) => f.id)).toEqual([reverb.id, filter.id, delay.id]);
    project = moveFx(project, "track-1", reverb.id, 99);
    expect(project.tracks[0].fx.map((f) => f.id)).toEqual([filter.id, delay.id, reverb.id]);
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

  it("supports reverb on the master bus with its own default params", () => {
    const project = addFx(createInitialProject(), "master", "reverb");
    expect(project.master.fx).toHaveLength(1);
    expect(project.master.fx[0].type).toBe("reverb");
    expect(project.master.fx[0].params).toEqual({ decay: 0.5, damping: 0.2, mix: 0 });
  });

  it("supports reverb on a track the same way as master", () => {
    const project = addFx(createInitialProject(), "track-1", "reverb");
    const track = project.tracks.find((t) => t.id === "track-1")!;
    expect(track.fx).toHaveLength(1);
    expect(track.fx[0].type).toBe("reverb");
  });

  it("supports compressor on the master bus with its own default params", () => {
    const project = addFx(createInitialProject(), "master", "compressor");
    expect(project.master.fx).toHaveLength(1);
    expect(project.master.fx[0].type).toBe("compressor");
    expect(project.master.fx[0].params).toEqual({
      threshold: -18,
      ratio: 4,
      attack: 0.01,
      release: 0.15,
      knee: 6,
      makeup: 0,
    });
  });

  it("supports compressor on a track the same way as master", () => {
    const project = addFx(createInitialProject(), "track-1", "compressor");
    const track = project.tracks.find((t) => t.id === "track-1")!;
    expect(track.fx).toHaveLength(1);
    expect(track.fx[0].type).toBe("compressor");
  });

  it("supports saturation on the master bus with its own default params", () => {
    const project = addFx(createInitialProject(), "master", "saturation");
    expect(project.master.fx).toHaveLength(1);
    expect(project.master.fx[0].type).toBe("saturation");
    expect(project.master.fx[0].params).toEqual({ drive: 0, asymmetry: 0, outputGain: 0, mix: 0 });
  });

  it("supports saturation on a track the same way as master", () => {
    const project = addFx(createInitialProject(), "track-1", "saturation");
    const track = project.tracks.find((t) => t.id === "track-1")!;
    expect(track.fx).toHaveLength(1);
    expect(track.fx[0].type).toBe("saturation");
  });

  it("supports chorus/flanger on the master bus with its own default params", () => {
    const project = addFx(createInitialProject(), "master", "chorusFlanger");
    expect(project.master.fx).toHaveLength(1);
    expect(project.master.fx[0].type).toBe("chorusFlanger");
    expect(project.master.fx[0].params).toEqual({
      rate: 2,
      depth: 5,
      delay: 15,
      feedback: 0,
      stereoPhase: 0.25,
      mix: 0,
    });
  });

  it("supports chorus/flanger on a track the same way as master", () => {
    const project = addFx(createInitialProject(), "track-1", "chorusFlanger");
    const track = project.tracks.find((t) => t.id === "track-1")!;
    expect(track.fx).toHaveLength(1);
    expect(track.fx[0].type).toBe("chorusFlanger");
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
