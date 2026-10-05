import { describe, expect, it } from "vitest";
import { createMidiInput, createMidiOutput } from "midi-core";
import { createMockDevice } from "midi-core/adapters/mock";
import { createAction, createSurfaceContext } from "midi-core/control-api";
import { createSequencerBindings } from "midi-core/configurations";
import { findDevice } from "midi-core/devices";
import { createControlSurface, generateControlMappings } from "midi-core/surface";
import { createInitialProject } from "../src/model/project";
import { projectReducer, type Action } from "../src/model/reducer";
import { totalBeats, type Project } from "../src/model/types";
import { createSequencerRegistry } from "../src/midi/sequencerContract";

function harness() {
  let project: Project = createInitialProject();
  const dispatch = (action: Action) => {
    project = projectReducer(project, action);
  };
  const patternId = project.patterns[0]!.id;
  const registry = createSequencerRegistry({ getProject: () => project, getPatternId: () => patternId, dispatch });
  return { registry, dispatch, getProject: () => project, patternId };
}

function stepOn(project: Project, trackId: string, start: number): boolean {
  return Object.values(project.patterns[0]!.notes).some((note) => note.trackId === trackId && note.start === start);
}

describe("sequencer contract: steps", () => {
  it("a step is on when a note starts on that track at that beat, and setValue adds or removes the note", () => {
    const { registry, getProject } = harness();
    const step = registry.getControl("step.0.2")!;

    expect(step.getValue()).toBe(false);
    step.setValue(true);
    expect(stepOn(getProject(), "track-1", 2)).toBe(true);
    expect(step.getValue()).toBe(true);

    step.setValue(false);
    expect(stepOn(getProject(), "track-1", 2)).toBe(false);
    expect(step.getValue()).toBe(false);
  });

  it("rows are tracks, and a step past the sequence length does not exist", () => {
    const { registry, getProject } = harness();
    const length = totalBeats(getProject().patterns[0]!, getProject().beatsPerBar);

    expect(registry.getControl("step.3.0")!.getValue()).toBe(false);
    expect(registry.getControl(`step.0.${length}`)).toBeUndefined();
  });

  it("reports the selected pattern's length in beats as steps.length", () => {
    const { registry, getProject } = harness();
    const project = getProject();
    expect(registry.getControl("steps.length")!.getValue()).toBe(totalBeats(project.patterns[0]!, project.beatsPerBar));
  });
});

describe("sequencer contract: mutes", () => {
  it("mute.N is track N's mute", () => {
    const { registry, getProject } = harness();
    registry.getControl("mute.2")!.setValue(true);
    expect(getProject().tracks[1]).toMatchObject({ id: "track-2", muted: true });
    expect(registry.getControl("mute.2")!.getValue()).toBe(true);
  });
});

describe("sequencer contract: the Launchpad configuration drives it", () => {
  it("a pad press on the device toggles a step in the sequencer, through midi-core's surface", async () => {
    const { registry, getProject } = harness();
    const device = createMockDevice();
    const input = createMidiInput(device.input);
    const output = createMidiOutput(device.output);
    const send = output.send.bind(output);
    // The Launchpad answers the Device Inquiry during setup, as the real device does.
    output.send = (message) => {
      send(message);
      if (message.type === "sysex" && message.raw[3] === 0x06) {
        device.input.emitRawMessage(Uint8Array.of(0xf0, 0x7e, 0x00, 0x06, 0x02, 0x00, 0x20, 0x29, 0x13, 0x01, 0x00, 0x00, 0x00, 0x04, 0x06, 0x07, 0xf7));
      }
    };

    const noop = createAction({ id: "noop", label: "noop" }, () => {});
    const launchpad = findDevice({ name: "Launchpad Mini MK3" })!;
    const surface = createControlSurface({
      profile: launchpad.profile,
      ports: { inputs: { "midi-in": input }, outputs: { "midi-out": output } },
      bindingTable: createSequencerBindings(input, launchpad.profile, {
        stepTemplate: "step.{row}.{column}",
        lengthControl: "steps.length",
        muteTemplate: "mute.{track}",
        actions: { play: noop, stop: noop },
      }).bindings,
      context: createSurfaceContext(),
      registry,
      generate: generateControlMappings,
      initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
    });

    await surface.attach();
    device.input.emitRawMessage(Uint8Array.of(0x90, 83, 127)); // pad-83: row 0 (track 1), column 2
    expect(stepOn(getProject(), "track-1", 2)).toBe(true);
    device.input.emitRawMessage(Uint8Array.of(0x80, 83, 0)); // release: no effect on a toggle
    expect(stepOn(getProject(), "track-1", 2)).toBe(true);
    device.input.emitRawMessage(Uint8Array.of(0x90, 83, 127));
    expect(stepOn(getProject(), "track-1", 2)).toBe(false);
    await surface.detach();
  });
});
