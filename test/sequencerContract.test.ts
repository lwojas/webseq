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

describe("sequencer contract: step duration (ECS-127)", () => {
  it("a column with no note has duration 0", () => {
    const { registry } = harness();
    expect(registry.getControl("step.0.2.duration")!.getValue()).toBe(0);
  });

  it("a freshly added note's duration is 1 (one step, DEFAULT_NOTE_DURATION), and growing the note moves the control", () => {
    const { registry, dispatch, getProject, patternId } = harness();
    registry.getControl("step.0.2")!.setValue(true);
    expect(registry.getControl("step.0.2.duration")!.getValue()).toBe(1);

    const noteId = Object.values(getProject().patterns[0]!.notes).find((n) => n.trackId === "track-1" && n.start === 2)!.id;
    dispatch({ type: "RESIZE_NOTE", patternId, noteId: noteId!, duration: 4 });
    expect(registry.getControl("step.0.2.duration")!.getValue()).toBe(4);
  });

  it("rows are tracks, and a duration control past the sequence length does not exist", () => {
    const { registry, getProject } = harness();
    const length = totalBeats(getProject().patterns[0]!, getProject().beatsPerBar);
    expect(registry.getControl("step.0.0.duration")).toBeDefined();
    expect(registry.getControl(`step.0.${length}.duration`)).toBeUndefined();
  });

  it("is feedback-only: setValue never changes the note", () => {
    const { registry, getProject } = harness();
    registry.getControl("step.0.2")!.setValue(true);
    const before = getProject().patterns[0]!.notes;

    registry.getControl("step.0.2.duration")!.setValue(5);
    expect(registry.getControl("step.0.2.duration")!.getValue()).toBe(1);
    expect(getProject().patterns[0]!.notes).toEqual(before);
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

describe("sequencer contract: playhead (ECS-131)", () => {
  function playheadHarness() {
    let project: Project = createInitialProject();
    let playing = false;
    let playhead = { patternId: null as string | null, beat: 0 };
    const dispatch = (action: Action) => {
      project = projectReducer(project, action);
    };
    const patternId = project.patterns[0]!.id;
    const registry = createSequencerRegistry({
      getProject: () => project,
      getPatternId: () => patternId,
      dispatch,
      faderPageSize: 8,
      getPlayhead: () => playhead,
      isPlaying: () => playing,
    });
    return {
      registry,
      patternId,
      setPlaying: (value: boolean) => {
        playing = value;
      },
      setPlayhead: (next: { patternId: string | null; beat: number }) => {
        playhead = next;
      },
    };
  }

  it("reports -1 while stopped, even if the transport has a resting position", () => {
    const { registry, patternId, setPlayhead } = playheadHarness();
    setPlayhead({ patternId, beat: 0 });
    expect(registry.getControl("transport.playhead")!.getValue()).toBe(-1);
  });

  it("reports the floored current beat while playing the selected pattern", () => {
    const { registry, patternId, setPlaying, setPlayhead } = playheadHarness();
    setPlaying(true);
    setPlayhead({ patternId, beat: 3.7 });
    expect(registry.getControl("transport.playhead")!.getValue()).toBe(3);
  });

  it("reports -1 while playing a pattern other than the one this sequencer currently shows", () => {
    const { registry, setPlaying, setPlayhead } = playheadHarness();
    setPlaying(true);
    setPlayhead({ patternId: "some-other-pattern", beat: 3.7 });
    expect(registry.getControl("transport.playhead")!.getValue()).toBe(-1);
  });

  it("is feedback-only: setValue never calls back into the transport", () => {
    const { registry, patternId, setPlaying, setPlayhead } = playheadHarness();
    setPlaying(true);
    setPlayhead({ patternId, beat: 1 });
    registry.getControl("transport.playhead")!.setValue(9);
    expect(registry.getControl("transport.playhead")!.getValue()).toBe(1);
  });

  it("pollPlayhead() fires onChange only when the floored column actually moves", () => {
    const { registry, patternId, setPlaying, setPlayhead } = playheadHarness();
    setPlaying(true);
    setPlayhead({ patternId, beat: 0 });
    const seen: number[] = [];
    registry.getControl("transport.playhead")!.onChange((value) => seen.push(value as number));

    registry.pollPlayhead();
    expect(seen).toEqual([]); // first poll just resolves the control -- it was already at the right value

    setPlayhead({ patternId, beat: 0.9 }); // still column 0
    registry.pollPlayhead();
    expect(seen).toEqual([]);

    setPlayhead({ patternId, beat: 1.2 }); // column 1 now
    registry.pollPlayhead();
    expect(seen).toEqual([1]);

    setPlaying(false); // stopping drops it back to -1
    registry.pollPlayhead();
    expect(seen).toEqual([1, -1]);
  });
});

describe("sequencer contract: pattern launch (ECS-117)", () => {
  function launchHarness() {
    let project: Project = createInitialProject();
    const dispatch = (action: Action) => {
      project = projectReducer(project, action);
    };
    dispatch({ type: "ADD_PATTERN" }); // patterns[1] exists for pattern.1.*
    let playing = false;
    let playhead = { patternId: null as string | null, beat: 0 };
    let queuedPatternId: string | null = null;
    const launchCalls: string[] = [];
    const cancelCalls: string[] = [];
    const registry = createSequencerRegistry({
      getProject: () => project,
      getPatternId: () => project.patterns[0]!.id,
      dispatch,
      faderPageSize: 8,
      getPlayhead: () => playhead,
      isPlaying: () => playing,
      getQueuedPatternId: () => queuedPatternId,
      requestPatternLaunch: (patternId) => launchCalls.push(patternId),
      cancelQueuedLaunch: () => cancelCalls.push("cancel"),
    });
    return {
      registry,
      getProject: () => project,
      setPlaying: (value: boolean) => {
        playing = value;
      },
      setPlayhead: (next: { patternId: string | null; beat: number }) => {
        playhead = next;
      },
      setQueuedPatternId: (id: string | null) => {
        queuedPatternId = id;
      },
      launchCalls,
      cancelCalls,
    };
  }

  it("pattern.<n>.playing is false until that pattern is both playing and the active one", () => {
    const { registry, getProject, setPlaying, setPlayhead } = launchHarness();
    const patternB = getProject().patterns[1]!.id;

    expect(registry.getControl("pattern.1.playing")!.getValue()).toBe(false);
    setPlaying(true);
    setPlayhead({ patternId: patternB, beat: 0 });
    expect(registry.getControl("pattern.1.playing")!.getValue()).toBe(true);
    expect(registry.getControl("pattern.0.playing")!.getValue()).toBe(false);

    setPlaying(false); // stopped -- a resting position must not still read as playing
    expect(registry.getControl("pattern.1.playing")!.getValue()).toBe(false);
  });

  it("pattern.<n>.playing is feedback-only", () => {
    const { registry, launchCalls, cancelCalls } = launchHarness();
    registry.getControl("pattern.0.playing")!.setValue(true);
    expect(launchCalls).toEqual([]);
    expect(cancelCalls).toEqual([]);
  });

  it("pattern.<n>.queued reflects the transport's queued pattern, and setValue requests/cancels a launch", () => {
    const { registry, getProject, setQueuedPatternId, launchCalls, cancelCalls } = launchHarness();
    const patternB = getProject().patterns[1]!.id;

    expect(registry.getControl("pattern.1.queued")!.getValue()).toBe(false);
    setQueuedPatternId(patternB);
    expect(registry.getControl("pattern.1.queued")!.getValue()).toBe(true);
    expect(registry.getControl("pattern.0.queued")!.getValue()).toBe(false);

    registry.getControl("pattern.1.queued")!.setValue(true);
    expect(launchCalls).toEqual([patternB]);

    registry.getControl("pattern.1.queued")!.setValue(false);
    expect(cancelCalls).toEqual(["cancel"]);
  });

  it("no control resolves for a pattern index past the project's pattern count", () => {
    const { registry } = launchHarness();
    expect(registry.getControl("pattern.2.playing")).toBeUndefined();
    expect(registry.getControl("pattern.2.queued")).toBeUndefined();
  });

  it("pollPatternLaunch() re-syncs both playing and queued controls from the transport's clock", () => {
    const { registry, getProject, setPlaying, setPlayhead, setQueuedPatternId } = launchHarness();
    const patternB = getProject().patterns[1]!.id;
    registry.getControl("pattern.1.playing"); // resolve + cache, same precondition pollPlayhead() has
    registry.getControl("pattern.1.queued");

    const playingSeen: boolean[] = [];
    const queuedSeen: boolean[] = [];
    registry.getControl("pattern.1.playing")!.onChange((value) => playingSeen.push(value as boolean));
    registry.getControl("pattern.1.queued")!.onChange((value) => queuedSeen.push(value as boolean));

    setPlaying(true);
    setPlayhead({ patternId: patternB, beat: 0 });
    setQueuedPatternId(patternB);
    registry.pollPatternLaunch();
    expect(playingSeen).toEqual([true]);
    expect(queuedSeen).toEqual([true]);
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

  it("shows the note's duration and the transport's playhead on the Launchpad pads, composed correctly (ECS-127, ECS-131)", async () => {
    let project: Project = createInitialProject();
    const dispatch = (action: Action) => {
      project = projectReducer(project, action);
    };
    const patternId = project.patterns[0]!.id;
    let playing = false;
    let playhead = { patternId: null as string | null, beat: 0 };
    const registry = createSequencerRegistry({
      getProject: () => project,
      getPatternId: () => patternId,
      dispatch,
      faderPageSize: 8,
      getPlayhead: () => playhead,
      isPlaying: () => playing,
    });

    const device = createMockDevice();
    const input = createMidiInput(device.input);
    const output = createMidiOutput(device.output);
    const send = output.send.bind(output);
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
        stepDurationTemplate: "step.{row}.{column}.duration",
        lengthControl: "steps.length",
        muteTemplate: "mute.{track}",
        playheadControl: "transport.playhead",
        actions: { play: noop, stop: noop },
      }).bindings,
      context: createSurfaceContext(),
      registry,
      generate: generateControlMappings,
      initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
    });

    await surface.attach();
    const sent = () => device.output.sentMessages.map(hex);
    const lastLed = (led: number) => {
      const matches = sent().filter((message) => message.startsWith(`f0 00 20 29 02 0d 03 03 ${led.toString(16).padStart(2, "0")} `));
      return matches[matches.length - 1];
    };

    // Row 0 (track-1), columns 0-3 are pad notes 81-84 (launchpad-mini-mk3.ts: note = (8-row)*10 + column+1).
    dispatch({ type: "ADD_NOTE", patternId, trackId: "track-1", start: 0 });
    const noteId = Object.values(project.patterns[0]!.notes).find((n) => n.trackId === "track-1" && n.start === 0)!.id;
    dispatch({ type: "RESIZE_NOTE", patternId, noteId, duration: 3 });
    registry.syncFromProject(project);
    expect(lastLed(81)).toBe("f0 00 20 29 02 0d 03 03 51 00 00 7f f7"); // the note's own colour (blue)
    expect(lastLed(82)).toBe("f0 00 20 29 02 0d 03 03 52 00 00 20 f7"); // continuation: dimmed blue
    expect(lastLed(83)).toBe("f0 00 20 29 02 0d 03 03 53 00 00 20 f7");
    expect(lastLed(84)).toBe("f0 00 20 29 02 0d 03 03 54 00 00 00 f7"); // past the 3-step span: off

    // Playback reaches column 1 (inside the note's duration): the playhead wins over the continuation colour.
    playing = true;
    playhead = { patternId, beat: 1 };
    registry.pollPlayhead();
    expect(lastLed(82)).toBe("f0 00 20 29 02 0d 03 03 52 7f 7f 7f f7"); // white

    // Stopping leaves the pad showing its own state again, not a stray lit pad.
    playing = false;
    registry.pollPlayhead();
    expect(lastLed(82)).toBe("f0 00 20 29 02 0d 03 03 52 00 00 20 f7");
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
