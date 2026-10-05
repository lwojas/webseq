// ECS-78: the device-knowledge half of this app's MIDI integration, now expressed as a
// midi-core `DeviceProfile` instead of as raw addresses baked into a hand-written
// `ControlMapping` (ECS-38's original shape, kept in mappings.ts's git history). This is the
// one place in the app that may name a CC number or a note number -- same boundary
// controlAdapter.ts/mappings.ts already drew, just one profile-schema layer lower, per
// midi-core's docs/control-surface-architecture.md ("Physical note/CC/program-change layout
// knowledge stays in profiles").
//
// Deliberately not Launchpad- or any-vendor-specific: this app doesn't pin itself to one
// real controller (that's midi-core's own ECS-79, "select and validate one real device"),
// it describes the two generic physical controls ECS-38 already proved against a real
// Launchpad Mini custom-mode fader bank -- a CC7 fader and a note-0 pad -- as a profile any
// MIDI controller sending those messages can satisfy.
import { DEVICE_PROFILE_SCHEMA_VERSION, type DeviceIdentity, type DeviceProfile, type DevicePortProfile, type PhysicalControl } from "midi-core/profile";

export const WEBSEQ_CONTROLLER_IDENTITY: DeviceIdentity = {
  id: "webseq.generic-fader-pad-controller",
  manufacturer: "Generic",
  model: "Generic MIDI Controller (CC7 fader + note-0 pad)",
};

export const WEBSEQ_CONTROLLER_PORTS: readonly DevicePortProfile[] = [
  { id: "main-in", type: "input", role: "main", required: true, messageTypes: ["control-change", "note-on", "note-off"] },
  { id: "main-out", type: "output", role: "main", required: true, messageTypes: ["control-change", "note-on", "note-off"] },
];

/**
 * CC7 (General MIDI "Channel Volume"). `input.channel` is deliberately omitted, not pinned
 * to `0`: ECS-38 found several real fader strips in one custom-mode bank all send CC7, one
 * per channel, and `channel: "any"` was needed so any of them drives this control. A
 * profile's `ControlAddress.channel` can't itself hold `"any"` (it describes one device's
 * actual wiring), but omitting it is exactly midi-core's "unresolved channel" case, and
 * `toMidiSource()` already maps a missing channel to `"any"` -- the same behavior, expressed
 * through the profile schema instead of hand-authored on a `ControlMapping`. Feedback, unlike
 * input, is pinned to channel 0: there's no "any" for an outgoing message.
 */
export const TRACK1_FADER: PhysicalControl = {
  id: "track1-fader",
  label: "Track 1 Volume Fader",
  kind: "fader",
  portId: "main-in",
  input: { address: { type: "control-change", controller: 7 } },
  feedback: { kind: "motorized", address: { address: { type: "control-change", controller: 7 }, channel: 0 } },
  feedbackPortId: "main-out",
};

/** Note 0, same "any channel in, channel 0 out" shape as the fader above, matching ECS-38's original mute mapping. */
export const TRACK1_PAD: PhysicalControl = {
  id: "track1-pad",
  label: "Track 1 Mute Pad",
  kind: "pad",
  portId: "main-in",
  input: { address: { type: "note", note: 0 } },
  feedback: { kind: "monochrome-led", address: { address: { type: "note", note: 0 }, channel: 0 } },
  feedbackPortId: "main-out",
};

export const WEBSEQ_CONTROLLER_CONTROLS: readonly PhysicalControl[] = [TRACK1_FADER, TRACK1_PAD];

export const WEBSEQ_CONTROLLER_PROFILE: DeviceProfile = {
  schemaVersion: DEVICE_PROFILE_SCHEMA_VERSION,
  identity: WEBSEQ_CONTROLLER_IDENTITY,
  ports: WEBSEQ_CONTROLLER_PORTS,
  controls: WEBSEQ_CONTROLLER_CONTROLS,
};
