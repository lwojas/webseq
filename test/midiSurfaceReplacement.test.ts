import { describe, expect, it } from "vitest";
import { createMidiInput, createMidiOutput } from "midi-core";
import { createMockDevice } from "midi-core/adapters/mock";
import { createControl, createControlRegistry, createSurfaceContext } from "midi-core/control-api";
import type { BooleanControlDef, NumericControlDef } from "midi-core/control-api";
import { MOCK_SURFACE_DEVICE_PROFILE, MOCK_SURFACE_KNOBS, MOCK_SURFACE_PADS } from "midi-core/profile";
import { createControlSurface, generateControlMappings, type SurfaceBindingTable } from "midi-core/surface";
import { createMockSurfaceDevice, createMockSurfaceHarness } from "midi-core/testing";
import { createInitialProject } from "../src/model/project";
import { projectReducer, type Action } from "../src/model/reducer";
import type { Project } from "../src/model/types";
import { createTrack1Controls, TRACK1_BINDING_TABLE } from "../src/midi/mappings";
import { WEBSEQ_CONTROLLER_PROFILE } from "../src/midi/surfaceProfile";

/**
 * ECS-78's two explicit swap demonstrations, each proven as an actual passing test rather than
 * asserted in prose:
 *
 * - "Demonstrate device replacement without changing the application": the exact same
 *   application code this app ships with (`createTrack1Controls()`, backed by the real
 *   `projectReducer`) bound against a completely different `DeviceProfile` --
 *   midi-core's own generic mock surface device, not this app's CC7/note-0 controller -- via a
 *   binding table that only differs in which `PhysicalControl` ids it names. `controlAdapter.ts`
 *   and `mappings.ts`'s `createTrack1Controls()` are untouched between the two tests.
 * - "Demonstrate application replacement without rewriting the device profile": this app's own
 *   `DeviceProfile` (surfaceProfile.ts) and `SurfaceBindingTable` (mappings.ts) bound against a
 *   bare pair of midi-core `Control`s that know nothing about `Project`/the reducer -- proving
 *   neither file has any webseq-specific assumption baked in, just `ControlId` strings.
 */
describe("ECS-78: device replacement (same application, a different device)", () => {
  it("the app's real track-1 controls work unmodified against midi-core's generic mock surface device", async () => {
    let project: Project = createInitialProject();
    const dispatch = (action: Action) => {
      project = projectReducer(project, action);
    };
    const controls = createTrack1Controls(() => project, dispatch);
    const registry = createControlRegistry([controls.volume, controls.muted]);

    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);
    const input = createMidiInput(device.input);
    const output = createMidiOutput(device.output);

    // Only this binding table is new -- it names `MOCK_SURFACE_DEVICE_PROFILE`'s own physical
    // controls (knob-1, pad-1), not this app's track1-fader/track1-pad. Nothing about
    // `controlAdapter.ts` or the two `ControlId`s it exposes changed.
    const bindingTable: SurfaceBindingTable = [
      {
        mode: "default",
        bindings: [
          { physicalControlId: MOCK_SURFACE_KNOBS[0]!.id, role: "track-fader", kind: "control", resolve: { kind: "static", controlId: controls.volume.def.id } },
          { physicalControlId: MOCK_SURFACE_PADS[0]!.id, role: "track-mute", kind: "control", resolve: { kind: "static", controlId: controls.muted.def.id } },
        ],
      },
    ];

    const surface = createControlSurface({
      profile: MOCK_SURFACE_DEVICE_PROFILE,
      ports: { inputs: { "main-in": input }, outputs: { "main-out": output } },
      bindingTable,
      context: createSurfaceContext(),
      registry,
      generate: generateControlMappings,
      initialNavigation: { mode: "default" },
    });

    await surface.attach();

    harness.turnKnob("knob-1", 127);
    expect(project.tracks[0]).toMatchObject({ id: "track-1", volume: 1.5 });

    harness.press("pad-1");
    expect(project.tracks[0]).toMatchObject({ id: "track-1", muted: true });

    await surface.detach();
  });
});

describe("ECS-78: application replacement (same device profile, a different application)", () => {
  it("surfaceProfile.ts/mappings.ts drive a bare pair of Controls with no Project/reducer behind them", async () => {
    const volumeDef: NumericControlDef = { id: "track.track-1.volume", label: "Stand-in Volume", kind: "number", min: 0, max: 127, default: 0 };
    const mutedDef: BooleanControlDef = { id: "track.track-1.muted", label: "Stand-in Mute", kind: "boolean", default: false };
    const volume = createControl(volumeDef);
    const muted = createControl(mutedDef);
    const registry = createControlRegistry([volume, muted]);

    const device = createMockDevice();
    const input = createMidiInput(device.input);
    const output = createMidiOutput(device.output);

    const surface = createControlSurface({
      profile: WEBSEQ_CONTROLLER_PROFILE,
      ports: { inputs: { "main-in": input }, outputs: { "main-out": output } },
      bindingTable: TRACK1_BINDING_TABLE,
      context: createSurfaceContext(),
      registry,
      generate: generateControlMappings,
      initialNavigation: { mode: "default" },
    });

    await surface.attach();

    device.input.emitRawMessage(Uint8Array.of(0xb0, 7, 127)); // CC7, channel 0, value 127
    expect(volume.getValue()).toBe(127);

    device.input.emitRawMessage(Uint8Array.of(0x90, 0, 127)); // Note On, note 0
    expect(muted.getValue()).toBe(true);

    await surface.detach();
  });
});
