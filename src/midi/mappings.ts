// The concrete MIDI <-> Control bindings this integration proves, per ECS-38: "architectural
// validation, not a complete MIDI feature set." One numeric control (CC7, the General MIDI
// "Channel Volume" controller -- a real control a Launchpad Mini can be made to send, not a
// synthetic pick) and one boolean control (a pad's Note On/Off) is enough to exercise both
// (source kind, control kind) pairings ECS-37's bindControlMapping() supports without a device
// profile or a full control surface.
//
// Deliberately scoped to track-1 only: proving the integration doesn't need all 16 tracks
// wired, and keeping to one makes the real-hardware test (move the fader, press the pad) easy
// to reason about.
//
// The volume mapping is pinned to channel 0 and carries no `feedback`, learned from testing
// against a real Launchpad Mini custom-mode fader bank (several CC7 fader strips, one per
// MIDI channel): `channel: "any"` made every strip in the bank drive this one control, and
// echoing the value back out as CC7 fought the strip's own LED-position feedback on every
// move (it reads its own incoming CC to reposition its LEDs, so echoing its own value back
// turns a smooth drag into something that feels like discrete button presses). Both are
// `bindControlMapping()` behaving exactly as documented -- it doesn't compare against a
// control's current value or suppress feedback for a change that just arrived from the same
// source (see docs/contracts/mapping-runtime.md's "No loop prevention" section in midi-core)
// -- so the fix belongs here, in which mapping this integration chooses to author, not in
// midi-core itself. The mute mapping below still has `feedback`, proving that direction still
// works; a plain pad has no position-tracking state to fight.

import type { ControlMapping } from "midi-core/mapping";
import type { Action } from "../model/reducer";
import type { Project, TrackId } from "../model/types";
import { createTrackMutedControl, createTrackVolumeControl, type ProjectControl } from "./controlAdapter";
import type { ControlDef } from "midi-core/control-api";

const BOUND_TRACK_ID: TrackId = "track-1";

export interface MidiControlBinding {
  readonly mapping: ControlMapping;
  readonly control: ProjectControl<ControlDef>;
}

/** The track-1 volume/mute bindings, built fresh per connect() so each call gets its own
 * Control instances (and therefore its own onChange listener sets) -- see useMidiControls. */
export function createTrack1Bindings(getProject: () => Project, dispatch: (action: Action) => void): MidiControlBinding[] {
  const volumeMapping: ControlMapping = {
    id: "cc7-track1-volume",
    control: `track.${BOUND_TRACK_ID}.volume`,
    source: { address: { type: "control-change", controller: 7 }, channel: 0 },
  };

  const muteMapping: ControlMapping = {
    id: "note0-track1-mute",
    control: `track.${BOUND_TRACK_ID}.muted`,
    source: { address: { type: "note", note: 0 }, channel: "any" },
    feedback: { address: { type: "note", note: 0 }, channel: 0 },
  };

  return [
    { mapping: volumeMapping, control: createTrackVolumeControl(BOUND_TRACK_ID, getProject, dispatch) },
    { mapping: muteMapping, control: createTrackMutedControl(BOUND_TRACK_ID, getProject, dispatch) },
  ];
}
