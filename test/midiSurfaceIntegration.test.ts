import { describe, expect, it } from "vitest";
import { createMidiInput, createMidiOutput } from "midi-core";
import { createMockDevice } from "midi-core/adapters/mock";
import { createControlRegistry, createSurfaceContext } from "midi-core/control-api";
import { createControlSurface, generateControlMappings } from "midi-core/surface";
import { createInitialProject } from "../src/model/project";
import { projectReducer, type Action } from "../src/model/reducer";
import type { Project } from "../src/model/types";
import { createTrack1Controls, TRACK1_BINDING_TABLE } from "../src/midi/mappings";
import { WEBSEQ_CONTROLLER_PROFILE } from "../src/midi/surfaceProfile";

/**
 * ECS-78's actual proof: the full chain this app ships with (model's real reducer,
 * controlAdapter.ts's real `ProjectControl`, midi-core's real `ControlSurface`) wired to
 * midi-core's mock device instead of a real controller -- the same substitution the mock
 * device exists for in midi-core itself. Unlike ECS-38 (which called `bindControlMapping()`
 * directly against a hand-written `ControlMapping`), this goes through the Control Surface
 * contract end to end: a `DeviceProfile` (surfaceProfile.ts) plus a `SurfaceBindingTable`
 * (mappings.ts) drive `createControlSurface()`'s own `attach()`/`generateControlMappings()`/
 * `bindControlMapping()` chain. Nothing in this file encodes a CC or note number -- only the
 * device profile does.
 */
function harness() {
  let project: Project = createInitialProject();
  const dispatch = (action: Action) => {
    project = projectReducer(project, action);
  };
  const device = createMockDevice();
  const input = createMidiInput(device.input);
  const output = createMidiOutput(device.output);
  const controls = createTrack1Controls(() => project, dispatch);
  const registry = createControlRegistry([controls.volume, controls.muted]);

  const surface = createControlSurface({
    profile: WEBSEQ_CONTROLLER_PROFILE,
    ports: { inputs: { "main-in": input }, outputs: { "main-out": output } },
    bindingTable: TRACK1_BINDING_TABLE,
    context: createSurfaceContext(),
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "default" },
  });

  return {
    getProject: () => project,
    commit: (action: Action) => dispatch(action),
    device,
    volumeControl: controls.volume,
    muteControl: controls.muted,
    attach: () => surface.attach(),
    detach: () => surface.detach(),
  };
}

describe("track-1 MIDI bindings via Control Surface — MIDI -> Control", () => {
  it("CC7 at max sets track-1's volume to the project's max track volume", async () => {
    const h = harness();
    await h.attach();
    h.device.input.emitRawMessage(Uint8Array.of(0xb0, 7, 127)); // CC 7, channel 0, value 127

    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", volume: 1.5 });
  });

  it("CC7 at 0 sets track-1's volume to silent", async () => {
    const h = harness();
    await h.attach();
    h.device.input.emitRawMessage(Uint8Array.of(0xb0, 7, 0));

    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", volume: 0 });
  });

  it("a CC on a different controller leaves track-1's volume untouched", async () => {
    const h = harness();
    await h.attach();
    h.device.input.emitRawMessage(Uint8Array.of(0xb0, 10, 127)); // CC 10 (pan), not 7

    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", volume: 1 });
  });

  // Regression test for a real bug found testing against a Launchpad Mini custom-mode fader
  // bank: several fader strips all send CC7, one per MIDI channel. The profile's fader control
  // leaves its input channel unresolved (surfaceProfile.ts), which `toMidiSource()` turns into
  // `"any"` -- same intended behavior, now expressed through the profile instead of a
  // hand-authored ControlMapping.
  it("CC7 on a different channel still sets track-1's volume (profile's fader channel is 'any')", async () => {
    const h = harness();
    await h.attach();
    h.device.input.emitRawMessage(Uint8Array.of(0xb1, 7, 127)); // CC 7, channel 1

    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", volume: 1.5 });
  });

  it("pad note 0 on toggles track-1's mute on, and off turns it back off", async () => {
    const h = harness();
    await h.attach();
    h.device.input.emitRawMessage(Uint8Array.of(0x90, 0, 127)); // Note On, note 0
    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", muted: true });

    h.device.input.emitRawMessage(Uint8Array.of(0x80, 0, 0)); // Note Off, note 0
    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", muted: false });
  });
});

describe("track-1 MIDI bindings via Control Surface — Control -> MIDI (feedback)", () => {
  // A volume change from elsewhere (a UI mixer fader, not the MIDI fader itself) sends CC7
  // feedback -- midi-core's ECS-57 echo suppression (see the "echo suppression" block below)
  // is what keeps this from fighting a real motorized fader.
  it("a volume change from a non-MIDI origin sends CC7 feedback once synced", async () => {
    const h = harness();
    await h.attach();
    h.commit({ type: "SET_TRACK_VOLUME", trackId: "track-1", volume: 0 });
    h.volumeControl.syncFromProject(h.getProject());

    expect(Array.from(h.device.output.sentMessages[0]!)).toEqual([0xb0, 7, 0]);
  });

  it("a mute change lights/unlights the pad via note-on/note-off feedback", async () => {
    const h = harness();
    await h.attach();
    h.commit({ type: "SET_TRACK_MUTED", trackId: "track-1", muted: true });
    h.muteControl.syncFromProject(h.getProject());

    expect(Array.from(h.device.output.sentMessages[0]!)).toEqual([0x90, 0, 127]);
  });
});

describe("track-1 MIDI bindings via Control Surface — MIDI echo suppression", () => {
  it("moving the fader does not echo CC7 feedback back to it", async () => {
    const h = harness();
    await h.attach();
    h.device.input.emitRawMessage(Uint8Array.of(0xb0, 7, 0)); // the fader itself, moved to 0

    expect(h.getProject().tracks[0]).toMatchObject({ id: "track-1", volume: 0 });
    h.volumeControl.syncFromProject(h.getProject()); // what useMidiControls' effect does on every Project change
    expect(h.device.output.sentMessages).toHaveLength(0);
  });

  it("a later UI-driven change to a different value still sends feedback", async () => {
    const h = harness();
    await h.attach();
    h.device.input.emitRawMessage(Uint8Array.of(0xb0, 7, 0)); // suppressed, per the test above
    h.volumeControl.syncFromProject(h.getProject());

    h.commit({ type: "SET_TRACK_VOLUME", trackId: "track-1", volume: 0.75 });
    h.volumeControl.syncFromProject(h.getProject());

    expect(Array.from(h.device.output.sentMessages[0]!)).toEqual([0xb0, 7, 64]);
  });
});

describe("track-1 MIDI bindings via Control Surface — lifecycle", () => {
  it("stops updating controls from MIDI once detached", async () => {
    const h = harness();
    await h.attach();
    await h.detach();

    h.device.input.emitRawMessage(Uint8Array.of(0xb0, 7, 127));
    expect(h.getProject().tracks[0]).toMatchObject({ volume: 1 });
  });

  it("stops sending feedback once detached", async () => {
    const h = harness();
    await h.attach();
    await h.detach();

    h.commit({ type: "SET_TRACK_MUTED", trackId: "track-1", muted: true });
    h.muteControl.syncFromProject(h.getProject());
    expect(h.device.output.sentMessages).toHaveLength(0);
  });
});
