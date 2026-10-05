// ECS-78: the application-meaning half of this app's MIDI integration -- which role each of
// surfaceProfile.ts's physical controls plays and which of this app's own `Control`s it drives
// -- expressed as a midi-core `SurfaceBindingTable` instead of a hand-written `ControlMapping`
// per control (ECS-38's original shape). No note/CC number appears below: that's entirely
// surfaceProfile.ts's job now, per midi-core's own "a binding never carries MIDI address data
// of its own" rule (docs/contracts/surface-bindings.md). This file only ever names a role and
// a `ControlId` -- it would look the same if surfaceProfile.ts's two controls were re-addressed
// to a different CC/note pair tomorrow.
//
// Deliberately scoped to track-1 only, same as ECS-38: proving the integration doesn't need
// all 16 tracks wired, and keeping to one makes the real-hardware test (move the fader, press
// the pad) easy to reason about.
import type { SurfaceBindingTable } from "midi-core/surface";
import type { Action } from "../model/reducer";
import type { Project, TrackId } from "../model/types";
import { createTrackMutedControl, createTrackVolumeControl, type ProjectControl } from "./controlAdapter";
import type { BooleanControlDef, NumericControlDef } from "midi-core/control-api";
import { TRACK1_FADER, TRACK1_PAD } from "./surfaceProfile";

const BOUND_TRACK_ID: TrackId = "track-1";

export interface Track1Controls {
  readonly volume: ProjectControl<NumericControlDef>;
  readonly muted: ProjectControl<BooleanControlDef>;
}

/** The track-1 volume/mute `Control`s, built fresh per connect() so each call gets its own
 * instances (and therefore its own onChange listener sets) -- see useMidiControls. Registered
 * into a `ControlRegistry` by the caller; this function knows nothing about midi-core's
 * surface runtime beyond the `Control` shape itself. */
export function createTrack1Controls(getProject: () => Project, dispatch: (action: Action) => void): Track1Controls {
  return {
    volume: createTrackVolumeControl(BOUND_TRACK_ID, getProject, dispatch),
    muted: createTrackMutedControl(BOUND_TRACK_ID, getProject, dispatch),
  };
}

/**
 * One mode ("default" -- this integration has no navigation/paging yet, so a single always-
 * active mode is sufficient, same as a `SurfaceBindingTable` with one entry is meant to
 * support). `resolve` is `"static"`: track-1 is the one track this integration binds,
 * regardless of application selection state -- the same scope ECS-38 chose.
 */
export const TRACK1_BINDING_TABLE: SurfaceBindingTable = [
  {
    mode: "default",
    bindings: [
      {
        physicalControlId: TRACK1_FADER.id,
        role: "track-fader",
        kind: "control",
        resolve: { kind: "static", controlId: `track.${BOUND_TRACK_ID}.volume` },
      },
      {
        physicalControlId: TRACK1_PAD.id,
        role: "track-mute",
        kind: "control",
        resolve: { kind: "static", controlId: `track.${BOUND_TRACK_ID}.muted` },
      },
    ],
  },
];
