import { describe, expect, it } from "vitest";
import { createMidiInput, createMidiOutput } from "midi-core";
import { MockMidiInput } from "midi-core/adapters/mock";
import { MockMidiOutput } from "midi-core/adapters/mock";
import { createAction, createSurfaceContext } from "midi-core/control-api";
import { createSequencerBindings, sequencerFaderCount, type SequencerContract } from "midi-core/configurations";
import { findDevice } from "midi-core/devices";
import { createControlSurface, generateControlMappings } from "midi-core/surface";
import { createInitialProject } from "../src/model/project";
import { projectReducer, type Action } from "../src/model/reducer";
import type { Project } from "../src/model/types";
import { createSequencerRegistry } from "../src/midi/sequencerContract";

/** The Launchpad's fader count, from midi-core: how many tracks one fader page shows (ECS-102). */
const PAGE_SIZE = sequencerFaderCount(findDevice({ name: "Launchpad Mini MK3 MIDI" })!.profile);

/** A registry over a project that the test can change, with the fader page as the test's own state (ECS-96). */
function harness(trackCount: number) {
  let project: Project = createInitialProject("Test", trackCount);
  let page = 0;
  const dispatch = (action: Action) => {
    project = projectReducer(project, action);
  };
  const patternId = project.patterns[0]!.id;
  const registry = createSequencerRegistry({
    getProject: () => project,
    getPatternId: () => patternId,
    dispatch,
    getFaderPage: () => page,
    faderPageSize: PAGE_SIZE,
  });
  return {
    registry,
    getProject: () => project,
    setPage(next: number) {
      page = next;
      registry.syncFromProject(project);
    },
  };
}

describe("the volume faders on the registry (ECS-96)", () => {
  it("fader 0 on page 0 is track 1's volume, on the application's own gain scale", () => {
    const { registry } = harness(16);
    const fader = registry.getControl("mixer.volume.0")!;
    expect(fader.def).toMatchObject({ kind: "number", min: 0, max: 1.5 });
    expect(fader.getValue()).toBe(1);
  });

  it("setting a fader sets its track's volume, through the reducer", () => {
    const { registry, getProject } = harness(16);
    registry.getControl("mixer.volume.2")!.setValue(0.5);
    expect(getProject().tracks[2]!.volume).toBe(0.5);
  });

  it("a page turn points every fader at the next eight tracks, and notifies its listeners with the new track's level", () => {
    const { registry, getProject, setPage } = harness(16);
    const fader = registry.getControl("mixer.volume.0")!;
    const seen: number[] = [];
    fader.onChange((value) => seen.push(value as number));

    getProject().tracks[8]!.volume = 0.4; // track 9, on page 1
    setPage(1);
    expect(seen).toEqual([0.4]);
    expect(registry.getControl("mixer.volume.0")!.getValue()).toBe(0.4);
  });

  it("a repaint notifies every fader, even when its level has not changed, so the device's colours are set again", () => {
    const { registry } = harness(16);
    const seen: number[] = [];
    registry.getControl("mixer.volume.0")!.onChange((value) => seen.push(value as number));
    registry.repaintFaders();
    expect(seen).toEqual([1]);
  });

  it("a fader with no track on the page reads 0, which is the device's off colour, and ignores writes", () => {
    const { registry, getProject, setPage } = harness(10);
    setPage(1); // tracks 9 and 10 only
    expect(registry.getControl("mixer.volume.0")!.getValue()).toBe(1);
    expect(registry.getControl("mixer.volume.2")!.getValue()).toBe(0);
    registry.getControl("mixer.volume.2")!.setValue(0.8);
    expect(getProject().tracks.every((track) => track.volume === 1)).toBe(true);
  });

  it("pan and send are not in the application yet, so they do not resolve", () => {
    const { registry } = harness(16);
    expect(registry.getControl("mixer.pan.0")).toBeUndefined();
    expect(registry.getControl("mixer.send.0")).toBeUndefined();
  });
});

describe("the volume faders through midi-core's surface (ECS-96)", () => {
  it("moves a track's volume from a DAW fader, pages with the DAW arrow, and moves the next eight tracks", async () => {
    let project: Project = createInitialProject("Test", 16);
    const dispatch = (action: Action) => {
      project = projectReducer(project, action);
    };
    const patternId = project.patterns[0]!.id;
    let page = 0;
    const registry = createSequencerRegistry({ getProject: () => project, getPatternId: () => patternId, dispatch, getFaderPage: () => page, faderPageSize: PAGE_SIZE });
    const turnPage = (delta: number) => {
      const lastPage = Math.ceil(project.tracks.length / PAGE_SIZE) - 1;
      page = Math.min(lastPage, Math.max(0, page + delta));
      registry.syncFromProject(project);
    };

    const portInfo = { name: "Launchpad Mini MK3", manufacturer: "Novation" };
    const midiIn = new MockMidiInput({ id: "midi-in", type: "input", ...portInfo });
    const midiOut = new MockMidiOutput({ id: "midi-out", type: "output", ...portInfo });
    const dawIn = new MockMidiInput({ id: "daw-in", type: "input", ...portInfo });
    const dawOut = new MockMidiOutput({ id: "daw-out", type: "output", ...portInfo });
    const device = findDevice({ name: "Launchpad Mini MK3 MIDI" })!;

    const contract: SequencerContract = {
      stepTemplate: "step.{row}.{column}",
      lengthControl: "steps.length",
      muteTemplate: "mute.{track}",
      trackCountControl: "tracks.count",
      actions: {},
      faderTemplates: { volume: "mixer.volume.{index}" },
      faderActions: {
        pageLeft: createAction({ id: "faders.pageLeft", label: "left" }, () => turnPage(-1)),
        pageRight: createAction({ id: "faders.pageRight", label: "right" }, () => turnPage(1)),
      },
    };
    const devices = {
      outputs: { "midi-out": createMidiOutput(midiOut), "daw-out": createMidiOutput(dawOut) },
      inputs: { "daw-in": createMidiInput(dawIn) },
      connectedPortIds: ["midi-in", "midi-out", "daw-in", "daw-out"],
    };
    const { bindings } = createSequencerBindings(createMidiInput(midiIn), device.profile, contract, devices);

    const surface = createControlSurface({
      profile: { ...device.profile, setup: undefined },
      ports: {
        inputs: { "midi-in": createMidiInput(midiIn), "daw-in": createMidiInput(dawIn) },
        outputs: { "midi-out": createMidiOutput(midiOut), "daw-out": createMidiOutput(dawOut) },
      },
      bindingTable: bindings,
      context: createSurfaceContext(),
      registry,
      generate: generateControlMappings,
      initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
    });
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const press = async (port: MockMidiInput, controller: number) => {
      port.emitRawMessage(new Uint8Array([0xb0, controller, 127]));
      await flush();
      port.emitRawMessage(new Uint8Array([0xb0, controller, 0]));
      await flush();
    };

    await surface.attach();
    await press(midiIn, 69); // side-69: enter the volume bank
    expect(surface.navigation.state.mode).toBe("faders-volume");

    // Fader 0 is CC 80 on channel 5. Full scale is the application's maximum gain, 1.5.
    dawIn.emitRawMessage(new Uint8Array([0xb4, 80, 127]));
    await flush();
    expect(project.tracks[0]!.volume).toBeCloseTo(1.5, 5);

    await press(dawIn, 94); // the DAW arrow right: the next page of eight tracks
    dawIn.emitRawMessage(new Uint8Array([0xb4, 80, 0]));
    await flush();
    expect(project.tracks[8]!.volume).toBeCloseTo(0, 5);
    expect(project.tracks[0]!.volume).toBeCloseTo(1.5, 5);

    await surface.detach();
  });
});
