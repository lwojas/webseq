import { describe, expect, it } from "vitest";
import { createMidiInput, createMidiOutput } from "midi-core";
import { createMockDevice } from "midi-core/adapters/mock";
import { bindControlMapping } from "midi-core/mapping";
import { createInitialProject } from "../src/model/project";
import { projectReducer, type Action } from "../src/model/reducer";
import type { Project } from "../src/model/types";
import { createTrack1Bindings } from "../src/midi/mappings";

/**
 * ECS-38's actual proof: the full chain this app ships with (model's real reducer, this
 * module's real ControlMapping + Control adapter, midi-core's real bindControlMapping) wired
 * to midi-core's mock device instead of a real Launchpad -- the same substitution the mock
 * device exists for in midi-core itself (see its own docs/contracts/mock-device.md), applied
 * one layer up. Nothing here is a fake of this app's own code; only the transport is fake.
 */
function harness() {
  let project: Project = createInitialProject();
  const dispatch = (action: Action) => {
    project = projectReducer(project, action);
  };
  const device = createMockDevice();
  const input = createMidiInput(device.input);
  const output = createMidiOutput(device.output);
  const bindings = createTrack1Bindings(() => project, dispatch);
  const unbinds = bindings.map(({ mapping, control }) => bindControlMapping(mapping, input, output, control));

  return {
    getProject: () => project,
    commit: (action: Action) => dispatch(action),
    device,
    volumeControl: bindings[0]!.control,
    muteControl: bindings[1]!.control,
    unbind: () => unbinds.forEach((u) => u()),
  };
}

describe("track-1 MIDI bindings — MIDI -> Control", () => {
  it("CC7 at max sets track-1's volume to the project's max track volume", () => {
    const h = harness();
    h.device.input.emitRawMessage(Uint8Array.of(0xb0, 7, 127)); // CC 7, channel 0, value 127

    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", volume: 1.5 });
  });

  it("CC7 at 0 sets track-1's volume to silent", () => {
    const h = harness();
    h.device.input.emitRawMessage(Uint8Array.of(0xb0, 7, 0));

    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", volume: 0 });
  });

  it("a CC on a different controller leaves track-1's volume untouched", () => {
    const h = harness();
    h.device.input.emitRawMessage(Uint8Array.of(0xb0, 10, 127)); // CC 10 (pan), not 7

    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", volume: 1 });
  });

  // Regression test for a real bug found testing against a Launchpad Mini custom-mode fader
  // bank: several fader strips all send CC7, one per MIDI channel. The mapping used to listen
  // on channel "any", so every strip in the bank drove track-1's volume, not just the one
  // intended -- see mappings.ts's doc comment.
  it("CC7 on a different channel leaves track-1's volume untouched", () => {
    const h = harness();
    h.device.input.emitRawMessage(Uint8Array.of(0xb1, 7, 127)); // CC 7, channel 1, not channel 0

    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", volume: 1 });
  });

  it("pad note 0 on toggles track-1's mute on, and off turns it back off", () => {
    const h = harness();
    h.device.input.emitRawMessage(Uint8Array.of(0x90, 0, 127)); // Note On, note 0
    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", muted: true });

    h.device.input.emitRawMessage(Uint8Array.of(0x80, 0, 0)); // Note Off, note 0
    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", muted: false });
  });
});

describe("track-1 MIDI bindings — Control -> MIDI (feedback)", () => {
  // The volume mapping deliberately has no `feedback` -- see mappings.ts's doc comment on why
  // echoing CC7 back fought a real Launchpad fader strip's own LED-position tracking.
  it("a volume change sends no feedback", () => {
    const h = harness();
    h.commit({ type: "SET_TRACK_VOLUME", trackId: "track-1", volume: 0 });
    h.volumeControl.syncFromProject(h.getProject());

    expect(h.device.output.sentMessages).toHaveLength(0);
  });

  it("a mute change lights/unlights the pad via note-on/note-off feedback", () => {
    const h = harness();
    h.commit({ type: "SET_TRACK_MUTED", trackId: "track-1", muted: true });
    h.muteControl.syncFromProject(h.getProject());

    expect(Array.from(h.device.output.sentMessages[0]!)).toEqual([0x90, 0, 127]);
  });
});

describe("track-1 MIDI bindings — unbind", () => {
  it("stops updating controls from MIDI once unbound", () => {
    const h = harness();
    h.unbind();

    h.device.input.emitRawMessage(Uint8Array.of(0xb0, 7, 127));
    expect(h.getProject().tracks[0]).toMatchObject({ volume: 1 });
  });

  it("stops sending feedback once unbound", () => {
    const h = harness();
    h.unbind();

    h.commit({ type: "SET_TRACK_MUTED", trackId: "track-1", muted: true });
    h.muteControl.syncFromProject(h.getProject());
    expect(h.device.output.sentMessages).toHaveLength(0);
  });
});
