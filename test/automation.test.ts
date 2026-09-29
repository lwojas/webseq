import { describe, expect, it } from "vitest";
import { addFx } from "../src/model/fx";
import { clearAutomationLane, removeAutomationPoint, setAutomationPoint, valueAtBeat, findLane } from "../src/model/automation";
import { createInitialProject } from "../src/model/project";

describe("automation lanes", () => {
  it("creates a lane on the first point and stores it on the correct target (track, not master)", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const fxId = project.tracks[0].fx[0].id;
    project = setAutomationPoint(project, "track-1", fxId, "cutoff", 0, 500);

    expect(project.tracks[0].automation).toHaveLength(1);
    expect(project.master.automation).toHaveLength(0);
  });

  it("master automation stays associated with master, independent of tracks", () => {
    let project = addFx(createInitialProject(), "master", "filter");
    const fxId = project.master.fx[0].id;
    project = setAutomationPoint(project, "master", fxId, "cutoff", 0, 500);

    expect(project.master.automation).toHaveLength(1);
    expect(project.tracks.every((t) => t.automation.length === 0)).toBe(true);
  });

  it("one track's automation does not affect another track's", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    project = addFx(project, "track-2", "filter");
    const fxId1 = project.tracks[0].fx[0].id;
    project = setAutomationPoint(project, "track-1", fxId1, "cutoff", 0, 500);

    expect(project.tracks[0].automation).toHaveLength(1);
    expect(project.tracks[1].automation).toHaveLength(0);
  });

  it("adds points in position order regardless of insertion order", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const fxId = project.tracks[0].fx[0].id;
    project = setAutomationPoint(project, "track-1", fxId, "cutoff", 8, 4000);
    project = setAutomationPoint(project, "track-1", fxId, "cutoff", 0, 500);

    const lane = findLane(project.tracks[0].automation, fxId, "cutoff")!;
    expect(lane.events.map((e) => e.position)).toEqual([0, 8]);
  });

  it("replaces the value at an existing position rather than duplicating it", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const fxId = project.tracks[0].fx[0].id;
    project = setAutomationPoint(project, "track-1", fxId, "cutoff", 0, 500);
    project = setAutomationPoint(project, "track-1", fxId, "cutoff", 0, 900);

    const lane = findLane(project.tracks[0].automation, fxId, "cutoff")!;
    expect(lane.events).toHaveLength(1);
    expect(lane.events[0].value).toBe(900);
  });

  it("linearly interpolates between two points", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const fxId = project.tracks[0].fx[0].id;
    project = setAutomationPoint(project, "track-1", fxId, "cutoff", 0, 500);
    project = setAutomationPoint(project, "track-1", fxId, "cutoff", 8, 4000);

    const lane = findLane(project.tracks[0].automation, fxId, "cutoff")!;
    expect(valueAtBeat(lane, 4)).toBeCloseTo(2250, 5);
  });

  it("holds the first value before the first point and the last value after the last point", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const fxId = project.tracks[0].fx[0].id;
    project = setAutomationPoint(project, "track-1", fxId, "cutoff", 4, 500);
    project = setAutomationPoint(project, "track-1", fxId, "cutoff", 12, 4000);

    const lane = findLane(project.tracks[0].automation, fxId, "cutoff")!;
    expect(valueAtBeat(lane, 0)).toBe(500);
    expect(valueAtBeat(lane, 16)).toBe(4000); // e.g. a pattern looping past the last point
  });

  it("returns null (no automation) for a parameter with no lane", () => {
    expect(valueAtBeat(undefined, 4)).toBeNull();
  });

  it("removes a single point, deleting the lane once it's empty", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const fxId = project.tracks[0].fx[0].id;
    project = setAutomationPoint(project, "track-1", fxId, "cutoff", 0, 500);
    project = removeAutomationPoint(project, "track-1", fxId, "cutoff", 0);

    expect(project.tracks[0].automation).toHaveLength(0);
  });

  it("clears an entire lane, leaving the FX's own base params untouched", () => {
    let project = addFx(createInitialProject(), "track-1", "filter");
    const fxId = project.tracks[0].fx[0].id;
    project = setAutomationPoint(project, "track-1", fxId, "cutoff", 0, 500);
    project = clearAutomationLane(project, "track-1", fxId, "cutoff");

    expect(project.tracks[0].automation).toHaveLength(0);
    expect(project.tracks[0].fx[0].params.cutoff).toBe(18000); // untouched default
  });
});
