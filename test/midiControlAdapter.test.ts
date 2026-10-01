import { describe, expect, it } from "vitest";
import { createInitialProject } from "../src/model/project";
import { projectReducer, type Action } from "../src/model/reducer";
import type { Project } from "../src/model/types";
import { createTrackMutedControl, createTrackVolumeControl } from "../src/midi/controlAdapter";

/** A minimal stand-in for App.tsx's `useReducer(projectReducer, ...)` + `projectRef` pair:
 * dispatch runs the real reducer and the test reads/passes the resulting project back in,
 * the same shape useMidiControls' project-watching effect drives syncFromProject() from. */
function harness() {
  let project: Project = createInitialProject();
  const dispatch = (action: Action) => {
    project = projectReducer(project, action);
  };
  return { getProject: () => project, dispatch, commit: (action: Action) => dispatch(action) };
}

describe("createTrackVolumeControl", () => {
  it("reads the track's current volume and declares the project's own volume range", () => {
    const { getProject, dispatch } = harness();
    const control = createTrackVolumeControl("track-1", getProject, dispatch);

    expect(control.getValue()).toBe(1);
    expect(control.def).toMatchObject({ kind: "number", min: 0, max: 1.5 });
  });

  it("setValue() dispatches SET_TRACK_VOLUME for the right track, not just updates a local field", () => {
    const h = harness();
    const control = createTrackVolumeControl("track-1", h.getProject, h.dispatch);

    control.setValue(0.5);

    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", volume: 0.5 });
    // A sibling track's control is untouched by track-1's setValue -- proves the dispatch is
    // scoped to the id the control was built for, not a global "volume" concept.
    expect(h.getProject().tracks[1]).toMatchObject({ id: "track-2", volume: 1 });
  });

  it("syncFromProject() fires onChange only when the value actually moved", () => {
    const h = harness();
    const control = createTrackVolumeControl("track-1", h.getProject, h.dispatch);
    const seen: Array<[number, number]> = [];
    control.onChange((value, previous) => seen.push([value, previous]));

    control.syncFromProject(h.getProject()); // unchanged project -- no fire
    expect(seen).toEqual([]);

    h.commit({ type: "SET_TRACK_VOLUME", trackId: "track-1", volume: 0.25 });
    control.syncFromProject(h.getProject());
    expect(seen).toEqual([[0.25, 1]]);
  });

  it("an unsubscribed onChange listener is not called again", () => {
    const h = harness();
    const control = createTrackVolumeControl("track-1", h.getProject, h.dispatch);
    const seen: number[] = [];
    const unsubscribe = control.onChange((value) => seen.push(value));
    unsubscribe();

    h.commit({ type: "SET_TRACK_VOLUME", trackId: "track-1", volume: 0.25 });
    control.syncFromProject(h.getProject());

    expect(seen).toEqual([]);
  });
});

describe("createTrackMutedControl", () => {
  it("reads the track's current mute state and declares a boolean def", () => {
    const { getProject, dispatch } = harness();
    const control = createTrackMutedControl("track-1", getProject, dispatch);

    expect(control.getValue()).toBe(false);
    expect(control.def).toMatchObject({ kind: "boolean" });
  });

  it("setValue() dispatches SET_TRACK_MUTED and syncFromProject() reports the change", () => {
    const h = harness();
    const control = createTrackMutedControl("track-1", h.getProject, h.dispatch);
    const seen: boolean[] = [];
    control.onChange((value) => seen.push(value));

    control.setValue(true);
    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", muted: true });

    control.syncFromProject(h.getProject());
    expect(seen).toEqual([true]);
  });
});
