import { describe, expect, it } from "vitest";
import { MASTER_BUS, NodeParam } from "webdsp";
import { syncBuses } from "../src/audio/busSync";
import { canRouteTo, createInitialProject, setTrackOutput, setTrackSoloed } from "../src/model/project";
import { effectiveTrackGain, resolvedOutput, trackById } from "../src/model/types";
import { mockRuntime } from "./mockRuntime";

const buses = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`track-${i + 1}`, i + 1]));
const outputs = (raw: ReturnType<typeof mockRuntime>["raw"]) =>
  raw.setNodeParameter.mock.calls.filter(([, p]) => p === NodeParam.BusOutput).map(([b, , v]) => [b, v]);

describe("track output routing (model)", () => {
  it("defaults to master and a default project carries no routing field", () => {
    const project = createInitialProject();
    expect(project.tracks.every((t) => !("outputTrack" in t))).toBe(true);
    expect(resolvedOutput(project, project.tracks[0])).toBe("master");
  });

  it("routes several tracks to one destination, and back to master", () => {
    let project = createInitialProject();
    for (const id of ["track-1", "track-2", "track-3"]) project = setTrackOutput(project, id, "track-4");
    expect(project.tracks.slice(0, 3).map((t) => resolvedOutput(project, t))).toEqual(["track-4", "track-4", "track-4"]);
    project = setTrackOutput(project, "track-1", null);
    expect("outputTrack" in trackById(project, "track-1")!).toBe(false);
  });

  it("supports chains, and rejects self-routes, unknown targets and loops", () => {
    let project = setTrackOutput(createInitialProject(), "track-1", "track-2");
    project = setTrackOutput(project, "track-2", "track-3");
    expect(resolvedOutput(project, trackById(project, "track-2")!)).toBe("track-3");
    expect(setTrackOutput(project, "track-1", "track-1")).toBe(project);
    expect(setTrackOutput(project, "track-1", "nope")).toBe(project);
    expect(setTrackOutput(project, "track-3", "track-1")).toBe(project); // 1 -> 2 -> 3 -> 1
    expect(canRouteTo(project, "track-3", "track-1")).toBe(false);
    expect(canRouteTo(project, "track-3", "track-5")).toBe(true);
  });

  it("falls back to master for a dangling or cyclic route in loaded data", () => {
    const project = createInitialProject();
    project.tracks[0].outputTrack = "gone";
    project.tracks[1].outputTrack = "track-3";
    project.tracks[2].outputTrack = "track-2";
    expect(resolvedOutput(project, project.tracks[0])).toBe("master");
    expect(resolvedOutput(project, project.tracks[1])).toBe("master");
    expect(resolvedOutput(project, project.tracks[2])).toBe("master");
  });

  it("soloing a source keeps the track it feeds audible", () => {
    let project = setTrackOutput(createInitialProject(), "track-1", "track-4");
    project = setTrackSoloed(project, "track-1", true);
    expect(effectiveTrackGain(project, trackById(project, "track-4")!)).toBe(trackById(project, "track-4")!.volume);
    expect(effectiveTrackGain(project, trackById(project, "track-5")!)).toBe(0);
  });
});

describe("track output routing (engine sync)", () => {
  it("sends nothing for a project without routing", () => {
    const { runtime, raw } = mockRuntime();
    syncBuses(runtime, createInitialProject(), buses);
    expect(outputs(raw)).toEqual([]);
  });

  it("maps the destination track to its bus, once", () => {
    const { runtime, raw } = mockRuntime();
    const project = setTrackOutput(setTrackOutput(createInitialProject(), "track-1", "track-4"), "track-2", "track-4");
    syncBuses(runtime, project, buses);
    syncBuses(runtime, project, buses);
    expect(outputs(raw)).toEqual([[1, 4], [2, 4]]);
  });

  it("returns a track to master", () => {
    const { runtime, raw } = mockRuntime();
    const routed = setTrackOutput(createInitialProject(), "track-1", "track-4");
    syncBuses(runtime, routed, buses);
    syncBuses(runtime, setTrackOutput(routed, "track-1", null), buses);
    expect(outputs(raw)).toEqual([[1, 4], [1, MASTER_BUS]]);
  });

  it("parks changed routes on master first, so swapping a route never trips the engine's loop check", () => {
    const { runtime, raw } = mockRuntime();
    syncBuses(runtime, setTrackOutput(createInitialProject(), "track-1", "track-2"), buses); // 1 -> 2
    raw.setNodeParameter.mockClear();
    const flipped = setTrackOutput(createInitialProject(), "track-2", "track-1"); // 2 -> 1, 1 -> master
    syncBuses(runtime, flipped, buses);
    expect(outputs(raw)).toEqual([[1, MASTER_BUS], [2, 1]]);
  });
});
