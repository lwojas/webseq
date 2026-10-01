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
// The volume mapping is pinned to channel 0, learned from testing against a real Launchpad
// Mini custom-mode fader bank: several CC7 fader strips share the controller number, one per
// MIDI channel, so `channel: "any"` made every strip in the bank drive this one control.
//
// It originally also had no `feedback`, because echoing the value back out as CC7 fought the
// fader strip's own LED-position tracking on every move (it reads its own incoming CC to
// reposition its LEDs, so echoing its own value back turned a smooth drag into something
// that felt like discrete button presses). That's fixed upstream now -- midi-core's
// bindControlMapping() (ECS-57) suppresses feedback for the exact value it just pushed in
// from MIDI, while still sending it for a change from anywhere else (this app's own mixer
// fader, say) -- so `feedback` is back here, and a UI-driven volume change now updates the
// fader strip's LEDs without a device-side move re-triggering the fight. See
// docs/contracts/mapping-runtime.md's "Echo suppression" section in midi-core for the detail.

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
    feedback: { address: { type: "control-change", controller: 7 }, channel: 0 },
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
