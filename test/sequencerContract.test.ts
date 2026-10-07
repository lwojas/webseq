import { describe, expect, it } from "vitest";
import { createMidiInput, createMidiOutput } from "midi-core";
import { createMockDevice } from "midi-core/adapters/mock";
import { createAction, createSurfaceContext } from "midi-core/control-api";
import { createSequencerBindings, sequencerFaderCount } from "midi-core/configurations";
import { findDevice } from "midi-core/devices";
import { createControlSurface, generateControlMappings } from "midi-core/surface";
import { createInitialProject } from "../src/model/project";
import { projectReducer, type Action } from "../src/model/reducer";
import { totalBeats, type Project } from "../src/model/types";
import { createBankActions, createSequencerRegistry } from "../src/midi/sequencerContract";

function harness() {
  let project: Project = createInitialProject();
  const dispatch = (action: Action) => {
    project = projectReducer(project, action);
  };
  const patternId = project.patterns[0]!.id;
  const faderPageSize = sequencerFaderCount(findDevice({ name: "Launchpad Mini MK3 MIDI" })!.profile);
  const registry = createSequencerRegistry({ getProject: () => project, getPatternId: () => patternId, dispatch, faderPageSize });
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

describe("sequencer contract: tracks", () => {
  it("reports the project's track count as tracks.count, which bounds vertical paging", () => {
    const { registry, getProject } = harness();
    expect(registry.getControl("tracks.count")!.getValue()).toBe(getProject().tracks.length);
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

describe("sequencer contract: bank (ECS-113)", () => {
  function bankHarness() {
    let project: Project = createInitialProject("Test", 64);
    let bank = 0;
    const dispatch = (action: Action) => {
      project = projectReducer(project, action);
    };
    const registry = createSequencerRegistry({
      getProject: () => project,
      getPatternId: () => project.patterns[0]!.id,
      dispatch,
      getBank: () => bank,
      setBank: (next) => {
        bank = next;
      },
      faderPageSize: 8,
    });
    return { registry, dispatch, getProject: () => project, getBankValue: () => bank };
  }

  it("bank.active reports the selected bank, so a device can light its button", () => {
    const { registry, getBankValue } = bankHarness();
    expect(registry.getControl("bank.active")!.getValue()).toBe(getBankValue());
    registry.getControl("bank.active")!.setValue(1);
    expect(registry.getControl("bank.active")!.getValue()).toBe(1);
  });

  it("setting bank.active selects that bank, and clamps a value outside A-D", () => {
    const { registry, getBankValue } = bankHarness();
    const bank = registry.getControl("bank.active")!;

    bank.setValue(2);
    expect(getBankValue()).toBe(2);
    expect(bank.getValue()).toBe(2);

    bank.setValue(9);
    expect(getBankValue()).toBe(3);
    bank.setValue(-1);
    expect(getBankValue()).toBe(0);
  });

  it("a bank switch changes no track's volume or mute", () => {
    const { registry, dispatch, getProject, getBankValue } = bankHarness();
    dispatch({ type: "SET_TRACK_VOLUME", trackId: "track-1", volume: 0.3 });
    dispatch({ type: "SET_TRACK_VOLUME", trackId: "track-20", volume: 1.2 });
    registry.getControl("mute.3")!.setValue(true);
    const before = getProject().tracks.map(({ volume, muted }) => ({ volume, muted }));

    registry.getControl("bank.active")!.setValue(3);
    expect(getBankValue()).toBe(3);

    expect(getProject().tracks.map(({ volume, muted }) => ({ volume, muted }))).toEqual(before);
  });
});

describe("bank actions (ECS-114)", () => {
  it("previous and next step through A-D and stop at the ends, and select[n] selects bank n", () => {
    let bank = 0;
    const actions = createBankActions(() => bank, (next) => {
      bank = next;
    });

    actions.previous!.invoke();
    expect(bank).toBe(0);
    actions.next!.invoke();
    actions.next!.invoke();
    expect(bank).toBe(2);
    actions.next!.invoke();
    actions.next!.invoke();
    expect(bank).toBe(3);

    actions.select![1]!.invoke();
    expect(bank).toBe(1);
  });
});

describe("bank buttons on the Launchpad (ECS-114)", () => {
  function launchpadBanks() {
    let project: Project = createInitialProject("Test", 64);
    let bank = 0;
    const dispatch = (action: Action) => {
      project = projectReducer(project, action);
    };
    const registry = createSequencerRegistry({
      getProject: () => project,
      getPatternId: () => project.patterns[0]!.id,
      dispatch,
      getBank: () => bank,
      setBank: (next) => {
        bank = next;
      },
      faderPageSize: 8,
    });
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
    const launchpad = findDevice({ name: "Launchpad Mini MK3" })!;
    const surface = createControlSurface({
      profile: launchpad.profile,
      ports: { inputs: { "midi-in": input }, outputs: { "midi-out": output } },
      bindingTable: createSequencerBindings(input, launchpad.profile, {
        stepTemplate: "step.{row}.{column}",
        lengthControl: "steps.length",
        muteTemplate: "mute.{track}",
        actions: {},
        bankActions: createBankActions(
          () => bank,
          (next) => {
            bank = next;
          },
        ),
        bankControl: "bank.active",
      }).bindings,
      context: createSurfaceContext(),
      registry,
      generate: generateControlMappings,
      initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
    });
    // The app re-renders with the new bank, and its hook syncs the registry: this is that step.
    const appChangedBank = () => registry.syncFromProject(project);
    return {
      device,
      registry,
      surface,
      appChangedBank,
      dispatch,
      getProject: () => project,
      getBank: () => bank,
      sent: () => device.output.sentMessages.map(hex),
      press: (controller: number) => {
        device.input.emitRawMessage(Uint8Array.of(0xb0, controller, 127));
        device.input.emitRawMessage(Uint8Array.of(0xb0, controller, 0));
      },
    };
  }

  /** The Launchpad's RGB LED message for `led` (a CC number), as the last one the device was sent for it. */
  const lastLed = (sent: string[], led: number) => {
    const matches = sent.filter((message) => message.startsWith(`f0 00 20 29 02 0d 03 03 ${led.toString(16)} `));
    return matches[matches.length - 1];
  };

  it("a bank button on the device selects that bank, and no track's level or mute changes", async () => {
    const { surface, registry, dispatch, press, appChangedBank, getProject, getBank } = launchpadBanks();
    await surface.attach();
    dispatch({ type: "SET_TRACK_VOLUME", trackId: "track-1", volume: 0.3 });
    registry.getControl("mute.3")!.setValue(true);
    const before = getProject().tracks.map(({ volume, muted }) => ({ volume, muted }));

    press(97); // top-row CC 97: bank C
    expect(getBank()).toBe(2);
    appChangedBank();
    expect(getProject().tracks.map(({ volume, muted }) => ({ volume, muted }))).toEqual(before);
    await surface.detach();
  });

  it("lights the active bank's button, and moves the light when the bank changes", async () => {
    const { surface, sent, press, appChangedBank } = launchpadBanks();
    await surface.attach();
    // Bank A is active when the surface attaches: CC 95 is lit green (the default bank colour), CC 96 dark.
    expect(lastLed(sent(), 95)).toBe("f0 00 20 29 02 0d 03 03 5f 00 7f 00 f7");
    expect(lastLed(sent(), 96)).toBe("f0 00 20 29 02 0d 03 03 60 00 00 00 f7");

    press(97);
    appChangedBank();
    expect(lastLed(sent(), 97)).toBe("f0 00 20 29 02 0d 03 03 61 00 7f 00 f7");
    expect(lastLed(sent(), 95)).toBe("f0 00 20 29 02 0d 03 03 5f 00 00 00 f7");
    await surface.detach();
  });
});

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}
