import { describe, expect, it } from "vitest";
import { createMidiInput, createMidiOutput } from "midi-core";
import { createMockDevice, MockMidiInput, MockMidiOutput } from "midi-core/adapters/mock";
import { createAction, createSurfaceContext } from "midi-core/control-api";
import { createSequencerBindings, sequencerFaderCount } from "midi-core/configurations";
import { findDevice } from "midi-core/devices";
import { createControlSurface, generateControlMappings } from "midi-core/surface";
import { createInitialProject } from "../src/model/project";
import { projectReducer, type Action } from "../src/model/reducer";
import { totalBeats, type FxTarget, type Project } from "../src/model/types";
import { FX_DEFS } from "../src/model/fx";
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

describe("sequencer contract: precomputed step coverage (ECS-153)", () => {
  it("a column with no note on that track is not covered", () => {
    const { registry } = harness();
    expect(registry.getControl("step.0.2.covered")!.getValue()).toBe(false);
  });

  it("a note's own starting column is not covered (even though it reads as on, via step.{row}.{column})", () => {
    const { registry } = harness();
    registry.getControl("step.0.2")!.setValue(true);
    expect(registry.getControl("step.0.2.covered")!.getValue()).toBe(false);
  });

  it("a column inside a longer note's span, after its start, is covered", () => {
    const { registry, dispatch, getProject, patternId } = harness();
    registry.getControl("step.0.2")!.setValue(true);
    const noteId = Object.values(getProject().patterns[0]!.notes).find((n) => n.trackId === "track-1" && n.start === 2)!.id;

    dispatch({ type: "RESIZE_NOTE", patternId, noteId, duration: 4 }); // covers columns 2 (start), 3, 4, 5
    expect(registry.getControl("step.0.3.covered")!.getValue()).toBe(true);
    expect(registry.getControl("step.0.5.covered")!.getValue()).toBe(true);
    expect(registry.getControl("step.0.6.covered")!.getValue()).toBe(false); // just past the span

    dispatch({ type: "RESIZE_NOTE", patternId, noteId, duration: 2 }); // shrinking un-covers columns live
    expect(registry.getControl("step.0.3.covered")!.getValue()).toBe(true);
    expect(registry.getControl("step.0.5.covered")!.getValue()).toBe(false);
  });

  it("only covers the track the note is actually on", () => {
    const { registry, dispatch, getProject, patternId } = harness();
    registry.getControl("step.0.0")!.setValue(true);
    const noteId = Object.values(getProject().patterns[0]!.notes).find((n) => n.trackId === "track-1" && n.start === 0)!.id;
    dispatch({ type: "RESIZE_NOTE", patternId, noteId, duration: 4 });

    expect(registry.getControl("step.0.2.covered")!.getValue()).toBe(true); // track-1, inside the span
    expect(registry.getControl("step.1.2.covered")!.getValue()).toBe(false); // track-2, same column
  });

  it("rows are tracks, and a coverage control past the sequence length does not exist", () => {
    const { registry, getProject } = harness();
    const length = totalBeats(getProject().patterns[0]!, getProject().beatsPerBar);
    expect(registry.getControl("step.0.0.covered")).toBeDefined();
    expect(registry.getControl(`step.0.${length}.covered`)).toBeUndefined();
  });

  it("is feedback-only: setValue never changes any note", () => {
    const { registry, dispatch, getProject, patternId } = harness();
    registry.getControl("step.0.0")!.setValue(true);
    const noteId = Object.values(getProject().patterns[0]!.notes).find((n) => n.trackId === "track-1" && n.start === 0)!.id;
    dispatch({ type: "RESIZE_NOTE", patternId, noteId, duration: 4 });
    const before = getProject().patterns[0]!.notes;

    registry.getControl("step.0.2.covered")!.setValue(false);
    expect(registry.getControl("step.0.2.covered")!.getValue()).toBe(true);
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

describe("sequencer contract: transport.isPlaying (ECS-145 follow-up)", () => {
  function isPlayingHarness() {
    const project: Project = createInitialProject();
    let playing = false;
    const registry = createSequencerRegistry({
      getProject: () => project,
      getPatternId: () => project.patterns[0]!.id,
      dispatch: () => {},
      faderPageSize: 8,
      isPlaying: () => playing,
    });
    return {
      registry,
      setPlaying: (value: boolean) => {
        playing = value;
      },
    };
  }

  it("reports 1 while playing, 0 while stopped", () => {
    const { registry, setPlaying } = isPlayingHarness();
    expect(registry.getControl("transport.isPlaying")!.getValue()).toBe(0);
    setPlaying(true);
    expect(registry.getControl("transport.isPlaying")!.getValue()).toBe(1);
    setPlaying(false);
    expect(registry.getControl("transport.isPlaying")!.getValue()).toBe(0);
  });

  it("is feedback-only: setValue never calls back into the transport", () => {
    const { registry, setPlaying } = isPlayingHarness();
    setPlaying(true);
    registry.getControl("transport.isPlaying")!.setValue(0);
    expect(registry.getControl("transport.isPlaying")!.getValue()).toBe(1);
  });

  it("pollPlayhead() fires onChange only when isPlaying actually flips", () => {
    const { registry, setPlaying } = isPlayingHarness();
    const seen: number[] = [];
    registry.getControl("transport.isPlaying")!.onChange((value) => seen.push(value as number));

    registry.pollPlayhead();
    expect(seen).toEqual([]); // already at the right value

    setPlaying(true);
    registry.pollPlayhead();
    expect(seen).toEqual([1]);

    registry.pollPlayhead(); // still playing -- no second notification
    expect(seen).toEqual([1]);

    setPlaying(false);
    registry.pollPlayhead();
    expect(seen).toEqual([1, 0]);
  });
});

describe("sequencer contract: pattern launch", () => {
  function launchHarness() {
    let project: Project = createInitialProject();
    const dispatch = (action: Action) => {
      project = projectReducer(project, action);
    };
    dispatch({ type: "ADD_PATTERN" }); // patterns[1] exists for pattern.1.*
    let playing = false;
    let playhead = { patternId: null as string | null, beat: 0 };
    let currentChainEntryId: string | null = null;
    let selectedPatternId = project.patterns[0]!.id;
    const registry = createSequencerRegistry({
      getProject: () => project,
      getPatternId: () => selectedPatternId,
      dispatch,
      faderPageSize: 8,
      getPlayhead: () => playhead,
      isPlaying: () => playing,
      getCurrentChainEntryId: () => currentChainEntryId,
      selectPattern: (id) => {
        selectedPatternId = id;
      },
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
      setCurrentChainEntryId: (id: string | null) => {
        currentChainEntryId = id;
      },
      getSelectedPatternId: () => selectedPatternId,
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
    const { registry, getProject } = launchHarness();
    const before = getProject();
    registry.getControl("pattern.0.playing")!.setValue(true);
    expect(getProject()).toBe(before); // unchanged -- no dispatch fired
  });

  it("pattern.<n>.queued reflects queue membership (other than the playing entry), and setValue queues/removes it", () => {
    const { registry, getProject, setPlaying, setPlayhead, setCurrentChainEntryId } = launchHarness();
    const patternA = getProject().patterns[0]!.id;
    const patternB = getProject().patterns[1]!.id;
    setPlaying(true);
    setPlayhead({ patternId: patternA, beat: 0 });
    setCurrentChainEntryId(getProject().patternChain[0]!.id);

    expect(registry.getControl("pattern.1.queued")!.getValue()).toBe(false);

    registry.getControl("pattern.1.queued")!.setValue(true);
    expect(getProject().patternChain.map((e) => e.patternId)).toEqual([patternA, patternB]);
    expect(registry.getControl("pattern.1.queued")!.getValue()).toBe(true);
    expect(registry.getControl("pattern.0.queued")!.getValue()).toBe(false); // A is playing, not "queued"

    registry.getControl("pattern.1.queued")!.setValue(false);
    expect(getProject().patternChain.map((e) => e.patternId)).toEqual([patternA]);
    expect(registry.getControl("pattern.1.queued")!.getValue()).toBe(false);
  });

  it("no control resolves for a pattern index past the project's pattern count", () => {
    const { registry } = launchHarness();
    expect(registry.getControl("pattern.2.playing")).toBeUndefined();
    expect(registry.getControl("pattern.2.queued")).toBeUndefined();
  });

  it("pollPatternLaunch() re-syncs both playing and queued controls from the transport's clock", () => {
    const { registry, getProject, setPlaying, setPlayhead, setCurrentChainEntryId } = launchHarness();
    const patternA = getProject().patterns[0]!.id;
    registry.getControl("pattern.0.playing"); // resolve + cache, same precondition pollPlayhead() has
    registry.getControl("pattern.1.queued");

    const playingSeen: boolean[] = [];
    const queuedSeen: boolean[] = [];
    registry.getControl("pattern.0.playing")!.onChange((value) => playingSeen.push(value as boolean));
    registry.getControl("pattern.1.queued")!.onChange((value) => queuedSeen.push(value as boolean));

    setPlaying(true);
    setPlayhead({ patternId: patternA, beat: 0 }); // A playing, so queuing B doesn't conflict with it
    setCurrentChainEntryId(getProject().patternChain[0]!.id);
    registry.getControl("pattern.1.queued")!.setValue(true); // dispatches, but nothing syncs/fires on its own yet
    expect(playingSeen).toEqual([]);
    expect(queuedSeen).toEqual([]);

    registry.pollPatternLaunch(); // re-reads the live project/clock and fires both
    expect(playingSeen).toEqual([true]);
    expect(queuedSeen).toEqual([true]);
  });

  it("pattern.<n>.selected reflects the editing selection, and setValue(true) selects it -- setValue(false) is a no-op", () => {
    const { registry, getProject, getSelectedPatternId } = launchHarness();
    const patternB = getProject().patterns[1]!.id;

    expect(registry.getControl("pattern.0.selected")!.getValue()).toBe(true);
    expect(registry.getControl("pattern.1.selected")!.getValue()).toBe(false);

    registry.getControl("pattern.1.selected")!.setValue(true);
    expect(getSelectedPatternId()).toBe(patternB);
    expect(registry.getControl("pattern.1.selected")!.getValue()).toBe(true);
    expect(registry.getControl("pattern.0.selected")!.getValue()).toBe(false);

    registry.getControl("pattern.1.selected")!.setValue(false);
    expect(getSelectedPatternId()).toBe(patternB); // no-op -- nothing to "deselect" to
  });

  it("pattern.<n>.name is the pattern's display name, feedback-only", () => {
    const { registry, getProject } = launchHarness();
    const before = getProject();

    expect(registry.getControl("pattern.0.name")!.getValue()).toBe("Pattern A");
    expect(registry.getControl("pattern.1.name")!.getValue()).toBe("Pattern B");

    registry.getControl("pattern.0.name")!.setValue("ignored");
    expect(getProject()).toBe(before); // unchanged -- no dispatch fired
  });

  it("pattern.<n>.bars reads and writes the pattern's bar count", () => {
    const { registry, getProject } = launchHarness();
    const patternB = getProject().patterns[1]!.id;

    expect(registry.getControl("pattern.1.bars")!.getValue()).toBe(1);
    registry.getControl("pattern.1.bars")!.setValue(4);
    expect(getProject().patterns.find((p) => p.id === patternB)!.bars).toBe(4);
    expect(registry.getControl("pattern.1.bars")!.getValue()).toBe(4);
  });

  it("patterns.count tracks the pattern library size", () => {
    const { registry, getProject } = launchHarness();
    expect(registry.getControl("patterns.count")!.getValue()).toBe(2);

    registry.getAction("patterns.create")!.invoke();
    expect(getProject().patterns).toHaveLength(3);
    expect(registry.getControl("patterns.count")!.getValue()).toBe(3); // read fresh, no sync needed
  });

  it("pattern.<n>.duplicate duplicates that pattern", () => {
    const { registry, getProject } = launchHarness();
    registry.getAction("pattern.1.duplicate")!.invoke();
    expect(getProject().patterns).toHaveLength(3);
    expect(getProject().patterns[2]!.name).toBe("Pattern B copy");
  });

  it("pattern.<n>.delete deletes that pattern, but is a safe no-op for the last remaining one", () => {
    const { registry, getProject } = launchHarness();
    registry.getAction("pattern.1.delete")!.invoke();
    expect(getProject().patterns).toHaveLength(1);

    // Only one pattern left -- pattern.1.delete no longer resolves (out of range), and
    // pattern.0.delete is refused by the model itself (removePattern's own guard).
    expect(registry.getAction("pattern.1.delete")).toBeUndefined();
    registry.getAction("pattern.0.delete")!.invoke();
    expect(getProject().patterns).toHaveLength(1);
  });

  it("queue.<slot>.pattern/.playing reflect the queue in order, entry-level not pattern-level", () => {
    const { registry, getProject, setPlaying, setCurrentChainEntryId } = launchHarness();
    registry.getControl("pattern.1.queued")!.setValue(true); // queue: [A, B]

    expect(registry.getControl("queue.0.pattern")!.getValue()).toBe("Pattern A");
    expect(registry.getControl("queue.1.pattern")!.getValue()).toBe("Pattern B");
    expect(registry.getControl("queue.2.pattern")).toBeUndefined();

    setPlaying(true);
    setCurrentChainEntryId(getProject().patternChain[1]!.id); // slot 1 (B) is the one sounding
    expect(registry.getControl("queue.0.playing")!.getValue()).toBe(false);
    expect(registry.getControl("queue.1.playing")!.getValue()).toBe(true);
  });

  it("queue.length tracks the queue size", () => {
    const { registry } = launchHarness();
    expect(registry.getControl("queue.length")!.getValue()).toBe(1);

    registry.getControl("pattern.1.queued")!.setValue(true); // queue: [A, B]
    expect(registry.getControl("queue.length")!.getValue()).toBe(2); // read fresh, no sync needed
  });

  it("queue.<slot>.remove removes exactly that entry, and is a safe no-op for the only one", () => {
    const { registry, getProject } = launchHarness();
    registry.getControl("pattern.1.queued")!.setValue(true); // queue: [A, B]

    registry.getAction("queue.1.remove")!.invoke();
    expect(getProject().patternChain.map((e) => e.patternId)).toEqual([getProject().patterns[0]!.id]);

    // Only one entry left -- queue.1.remove no longer resolves (out of range).
    expect(registry.getAction("queue.1.remove")).toBeUndefined();
    registry.getAction("queue.0.remove")!.invoke(); // refused by the model itself -- queue never empties
    expect(getProject().patternChain).toHaveLength(1);
  });

  it("no control/action resolves past the pattern/queue count", () => {
    const { registry } = launchHarness();
    expect(registry.getControl("pattern.2.selected")).toBeUndefined();
    expect(registry.getControl("pattern.2.name")).toBeUndefined();
    expect(registry.getControl("pattern.2.bars")).toBeUndefined();
    expect(registry.getControl("queue.1.pattern")).toBeUndefined();
    expect(registry.getControl("queue.1.playing")).toBeUndefined();
    expect(registry.getAction("pattern.2.duplicate")).toBeUndefined();
    expect(registry.getAction("pattern.2.delete")).toBeUndefined();
    expect(registry.getAction("queue.1.remove")).toBeUndefined();
  });
});

describe("sequencer contract: fx (ECS-149)", () => {
  function fxHarness() {
    let project: Project = createInitialProject();
    const dispatch = (action: Action) => {
      project = projectReducer(project, action);
    };
    let target: FxTarget = "master";
    let selectedFxId: string | null = null;
    const registry = createSequencerRegistry({
      getProject: () => project,
      getPatternId: () => project.patterns[0]!.id,
      dispatch,
      faderPageSize: 8,
      getTarget: () => target,
      getSelectedFxId: () => selectedFxId,
      selectFx: (id) => {
        selectedFxId = id;
      },
    });
    return {
      registry,
      dispatch,
      getProject: () => project,
      setTarget: (next: FxTarget) => {
        target = next;
      },
      getSelectedFxId: () => selectedFxId,
    };
  }

  it("fx.count reflects the current target's chain size, scoped to that target only", () => {
    const { registry, dispatch, getProject, setTarget } = fxHarness();
    expect(registry.getControl("fx.count")!.getValue()).toBe(0);

    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" });
    expect(registry.getControl("fx.count")!.getValue()).toBe(1);

    const trackId = getProject().tracks[0]!.id;
    setTarget(trackId);
    expect(registry.getControl("fx.count")!.getValue()).toBe(0); // master's FX doesn't leak into a track's count

    dispatch({ type: "ADD_FX", target: trackId, fxType: "delay" });
    expect(registry.getControl("fx.count")!.getValue()).toBe(1);
  });

  it("fx.<n>.enabled reads the FX's On state, and setValue dispatches SET_FX_ENABLED", () => {
    const { registry, dispatch, getProject } = fxHarness();
    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" });
    const fxId = getProject().master.fx[0]!.id;

    expect(registry.getControl("fx.0.enabled")!.getValue()).toBe(true); // addFx defaults to enabled
    registry.getControl("fx.0.enabled")!.setValue(false);
    expect(getProject().master.fx.find((f) => f.id === fxId)!.enabled).toBe(false);
    expect(registry.getControl("fx.0.enabled")!.getValue()).toBe(false);
  });

  it("fx.<n>.name is the FX type's display label, read-only", () => {
    const { registry, dispatch, getProject } = fxHarness();
    dispatch({ type: "ADD_FX", target: "master", fxType: "delay" });
    const before = getProject();

    expect(registry.getControl("fx.0.name")!.getValue()).toBe("Delay");
    registry.getControl("fx.0.name")!.setValue("ignored");
    expect(getProject()).toBe(before); // unchanged -- no dispatch fired
  });

  it("fx.<n>.selected reflects the editing selection, and setValue(true) selects it -- setValue(false) is a no-op", () => {
    const { registry, dispatch, getProject, getSelectedFxId } = fxHarness();
    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" });
    dispatch({ type: "ADD_FX", target: "master", fxType: "delay" });
    const delayId = getProject().master.fx[1]!.id;

    expect(registry.getControl("fx.0.selected")!.getValue()).toBe(false);
    expect(registry.getControl("fx.1.selected")!.getValue()).toBe(false);

    registry.getControl("fx.1.selected")!.setValue(true);
    expect(getSelectedFxId()).toBe(delayId);
    expect(registry.getControl("fx.1.selected")!.getValue()).toBe(true);
    expect(registry.getControl("fx.0.selected")!.getValue()).toBe(false);

    registry.getControl("fx.1.selected")!.setValue(false);
    expect(getSelectedFxId()).toBe(delayId); // no-op -- nothing to "deselect" to
  });

  it("navigation treats a bypassed FX as present/selectable, same as FxChainStrip's own chips", () => {
    const { registry, dispatch, getProject, getSelectedFxId } = fxHarness();
    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" });
    const fxId = getProject().master.fx[0]!.id;
    dispatch({ type: "SET_FX_ENABLED", target: "master", fxId, enabled: false });

    expect(registry.getControl("fx.0.selected")).toBeDefined(); // still resolves/selectable while bypassed
    registry.getControl("fx.0.selected")!.setValue(true);
    expect(getSelectedFxId()).toBe(fxId);
  });

  it("fx.selected.index is -1 with nothing selected, and tracks the selected FX's position", () => {
    const { registry, dispatch } = fxHarness();
    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" });
    dispatch({ type: "ADD_FX", target: "master", fxType: "delay" });

    expect(registry.getControl("fx.selected.index")!.getValue()).toBe(-1);
    registry.getControl("fx.1.selected")!.setValue(true);
    expect(registry.getControl("fx.selected.index")!.getValue()).toBe(1);
    expect(registry.getControl("fx.selected.enabled")!.getValue()).toBe(true);
    expect(registry.getControl("fx.selected.name")!.getValue()).toBe("Delay");
  });

  it("fx.<n>.params.count / fx.selected.params.count match that FX type's parameter count", () => {
    const { registry, dispatch } = fxHarness();
    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" }); // mode, cutoff, resonance
    registry.getControl("fx.0.selected")!.setValue(true);

    expect(registry.getControl("fx.0.params.count")!.getValue()).toBe(FX_DEFS.filter.params.length);
    expect(registry.getControl("fx.selected.params.count")!.getValue()).toBe(FX_DEFS.filter.params.length);
  });

  it("fx.<n>.param.<p> reads and writes the parameter at that ordered position, with that type's own range/unit/step", () => {
    const { registry, dispatch, getProject } = fxHarness();
    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" });
    const fxId = getProject().master.fx[0]!.id;
    const cutoff = registry.getControl("fx.0.param.1")!; // filter: [mode, cutoff, resonance]

    expect(cutoff.def.kind).toBe("number");
    expect((cutoff.def as { min: number; max: number; unit?: string }).min).toBe(FX_DEFS.filter.params[1]!.min);
    expect((cutoff.def as { unit?: string }).unit).toBe("Hz");
    expect(cutoff.getValue()).toBe(FX_DEFS.filter.params[1]!.default);

    cutoff.setValue(1000);
    expect(getProject().master.fx.find((f) => f.id === fxId)!.params.cutoff).toBe(1000);
    expect(cutoff.getValue()).toBe(1000);
  });

  it("no fx.<n>.param control resolves past that FX type's own parameter count", () => {
    const { registry, dispatch } = fxHarness();
    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" }); // 3 params: indices 0-2
    expect(registry.getControl("fx.0.param.2")).toBeDefined();
    expect(registry.getControl("fx.0.param.3")).toBeUndefined();
  });

  it("no fx control resolves past fx.count, or without a target", () => {
    const { registry, dispatch, setTarget } = fxHarness();
    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" });
    expect(registry.getControl("fx.1.enabled")).toBeUndefined();
    expect(registry.getControl("fx.1.selected")).toBeUndefined();

    setTarget("no-such-track");
    expect(registry.getControl("fx.0.enabled")).toBeUndefined();
    expect(registry.getControl("fx.count")!.getValue()).toBe(0);
  });

  it("fx.selected.param.<p> re-resolves to the newly selected FX's own def/value when the selection changes -- not the previously selected FX's stale def", () => {
    const { registry, dispatch } = fxHarness();
    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" }); // index 0
    dispatch({ type: "ADD_FX", target: "master", fxType: "delay" }); // index 1

    registry.getControl("fx.0.selected")!.setValue(true); // select the filter
    const asFilter = registry.getControl("fx.selected.param.1")!; // filter.cutoff: 40..18000 Hz
    expect(asFilter.getValue()).toBe(18000);
    expect((asFilter.def as { max: number }).max).toBe(18000);

    registry.getControl("fx.1.selected")!.setValue(true); // reselect the delay
    const asDelay = registry.getControl("fx.selected.param.1")!; // delay.feedback: 0..0.95, default 0.3
    expect(asDelay.getValue()).toBe(0.3);
    expect((asDelay.def as { max: number }).max).toBe(0.95);
    expect(asDelay.def.id).toBe("fx.selected.param.1");
  });

  it("fx.<n>.param.<p> re-resolves correctly after an earlier FX's removal shifts a different-typed FX into that position", () => {
    const { registry, dispatch, getProject } = fxHarness();
    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" }); // index 0: mode, cutoff, resonance
    dispatch({ type: "ADD_FX", target: "master", fxType: "delay" }); // index 1: time, feedback, mix
    const filterId = getProject().master.fx[0]!.id;

    const asFilter = registry.getControl("fx.0.param.1")!; // cached: filter.cutoff
    expect(asFilter.getValue()).toBe(18000);

    dispatch({ type: "REMOVE_FX", target: "master", fxId: filterId }); // delay shifts down to index 0
    const asDelay = registry.getControl("fx.0.param.1")!; // must now mean delay.feedback, not stale filter.cutoff
    expect(asDelay.getValue()).toBe(0.3);
    expect((asDelay.def as { max: number }).max).toBe(0.95);
  });

  it("fx.next/fx.previous page through the chain in order and clamp at the ends; starting unselected goes to the first/last", () => {
    const { registry, dispatch, getProject, getSelectedFxId } = fxHarness();
    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" });
    dispatch({ type: "ADD_FX", target: "master", fxType: "delay" });
    dispatch({ type: "ADD_FX", target: "master", fxType: "reverb" });
    const [filterId, , reverbId] = getProject().master.fx.map((f) => f.id);

    registry.getAction("fx.next")!.invoke(); // nothing selected -- goes to the first
    expect(getSelectedFxId()).toBe(filterId);

    registry.getAction("fx.next")!.invoke();
    registry.getAction("fx.next")!.invoke();
    expect(getSelectedFxId()).toBe(reverbId);
    registry.getAction("fx.next")!.invoke(); // clamps at the end
    expect(getSelectedFxId()).toBe(reverbId);

    registry.getAction("fx.previous")!.invoke();
    registry.getAction("fx.previous")!.invoke();
    registry.getAction("fx.previous")!.invoke();
    expect(getSelectedFxId()).toBe(filterId);
    registry.getAction("fx.previous")!.invoke(); // clamps at the start
    expect(getSelectedFxId()).toBe(filterId);
  });

  it("fx.previous with nothing selected goes to the last FX, and both actions are safe no-ops on an empty chain", () => {
    const { registry, dispatch, getProject, getSelectedFxId } = fxHarness();
    expect(registry.getAction("fx.next")).toBeDefined();
    registry.getAction("fx.next")!.invoke(); // empty chain -- no-op, no throw
    expect(getSelectedFxId()).toBeNull();

    dispatch({ type: "ADD_FX", target: "master", fxType: "filter" });
    dispatch({ type: "ADD_FX", target: "master", fxType: "delay" });
    const delayId = getProject().master.fx[1]!.id;

    registry.getAction("fx.previous")!.invoke();
    expect(getSelectedFxId()).toBe(delayId);
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
    expect(lastLed(82)).toBe("f0 00 20 29 02 0d 03 03 52 00 46 64 f7"); // teal (ECS-150; stale "white" expectation fixed here)

    // Stopping leaves the pad showing its own state again, not a stray lit pad.
    playing = false;
    registry.pollPlayhead();
    expect(lastLed(82)).toBe("f0 00 20 29 02 0d 03 03 52 00 00 20 f7");
    await surface.detach();
  });

  it("shows the same continuation and playhead feedback via stepCoverageTemplate's fast path, with no duration template at all (ECS-153)", async () => {
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
        stepCoverageTemplate: "step.{row}.{column}.covered", // no stepDurationTemplate: the scan never runs
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

    dispatch({ type: "ADD_NOTE", patternId, trackId: "track-1", start: 0 });
    const noteId = Object.values(project.patterns[0]!.notes).find((n) => n.trackId === "track-1" && n.start === 0)!.id;
    dispatch({ type: "RESIZE_NOTE", patternId, noteId, duration: 3 });
    registry.syncFromProject(project);
    expect(lastLed(81)).toBe("f0 00 20 29 02 0d 03 03 51 00 00 7f f7"); // the note's own colour (blue)
    expect(lastLed(82)).toBe("f0 00 20 29 02 0d 03 03 52 00 00 20 f7"); // continuation: dimmed blue
    expect(lastLed(83)).toBe("f0 00 20 29 02 0d 03 03 53 00 00 20 f7");
    expect(lastLed(84)).toBe("f0 00 20 29 02 0d 03 03 54 00 00 00 f7"); // past the 3-step span: off

    playing = true;
    playhead = { patternId, beat: 1 };
    registry.pollPlayhead();
    expect(lastLed(82)).toBe("f0 00 20 29 02 0d 03 03 52 00 46 64 f7"); // teal: playhead wins (ECS-150)

    playing = false;
    registry.pollPlayhead();
    expect(lastLed(82)).toBe("f0 00 20 29 02 0d 03 03 52 00 00 20 f7");
    await surface.detach();
  });
});

describe("sequencer contract: the Push mk1's contextual selection buttons drive track selection (ECS-155)", () => {
  // The Push mk1 profile declares no setup/handshake (push-mk1.ts's own doc comment), unlike the
  // Launchpad above -- a plain MockMidiInput/MockMidiOutput pair is enough, no Device Inquiry reply needed.
  function pushHarness() {
    let project: Project = createInitialProject("Test", 16);
    let target: FxTarget = "master";
    const dispatch = (action: Action) => {
      project = projectReducer(project, action);
    };
    const registry = createSequencerRegistry({
      getProject: () => project,
      getPatternId: () => project.patterns[0]!.id,
      dispatch,
      faderPageSize: 8,
      getTarget: () => target,
      selectTarget: (next) => {
        target = next;
      },
    });

    const rawInput = new MockMidiInput({ id: "user-port-in", type: "input", name: "in", manufacturer: null });
    const rawOutput = new MockMidiOutput({ id: "user-port-out", type: "output", name: "out", manufacturer: null });
    const input = createMidiInput(rawInput);
    const output = createMidiOutput(rawOutput);
    const noop = createAction({ id: "noop", label: "noop" }, () => {});
    const push = findDevice({ name: "Ableton Push User Port" })!;
    const surface = createControlSurface({
      profile: { ...push.profile, setup: undefined },
      ports: { inputs: { "user-port-in": input }, outputs: { "user-port-out": output } },
      bindingTable: createSequencerBindings(input, push.profile, {
        stepTemplate: "step.{row}.{column}",
        lengthControl: "steps.length",
        muteTemplate: "mute.{track}",
        trackCountControl: "tracks.count",
        actions: { play: noop, stop: noop },
        selectionIndexControl: "selection.index",
        selectionClearValue: -1,
      }).bindings,
      context: createSurfaceContext(),
      registry,
      generate: generateControlMappings,
      initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
    });

    const pressCc = (controller: number) => {
      rawInput.emitRawMessage(Uint8Array.of(0xb0, controller, 127));
      rawInput.emitRawMessage(Uint8Array.of(0xb0, controller, 0));
    };
    const lastValue = (controller: number): number | undefined => {
      const matches = rawOutput.sentMessages.filter((bytes) => bytes[0] === 0xb0 && bytes[1] === controller);
      return matches[matches.length - 1]?.[2];
    };

    return {
      registry,
      surface,
      pressCc,
      lastValue,
      getTarget: () => target,
      // The app re-renders with the new target, and useMidiControls.ts's own [fxTarget] effect
      // syncs the registry: this is that step (the same convention launchpadBanks()'s own
      // appChangedBank already uses for bank.active).
      appChangedTarget: () => registry.syncFromProject(project),
    };
  }

  it("a press on CC 36-43 selects the track at that position: 'slot 3 was activated' resolves to track-4 here, never inside midi-core", async () => {
    const { surface, pressCc, getTarget } = pushHarness();
    await surface.attach();

    pressCc(39); // button-select-4, column 3 (page 0)
    expect(getTarget()).toBe("track-4");
    await surface.detach();
  });

  it("CC 28 (Master) clears the selection back to the app's own master FX target", async () => {
    const { surface, pressCc, getTarget } = pushHarness();
    await surface.attach();

    pressCc(37); // select track-2
    expect(getTarget()).toBe("track-2");

    pressCc(28); // Master
    expect(getTarget()).toBe("master");
    await surface.detach();
  });

  it("selecting a track directly in the app lights the matching button on the Push, with no device press at all", async () => {
    const { surface, registry, lastValue, getTarget, appChangedTarget } = pushHarness();
    await surface.attach();
    expect(getTarget()).toBe("master");

    // The same thing clicking a track row in the mixer does: App.tsx's handleSelectTarget, which
    // the real app's [fxTarget] effect then syncs to the registry -- appChangedTarget() is that step.
    registry.getControl("selection.index")!.setValue(5); // track-6
    appChangedTarget();
    expect(lastValue(41)).toBe(127); // button-select-6, column 5: now lit full
    expect(lastValue(36)).toBe(1); // button-select-1: still just dim
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

describe("sequencer contract: selection (ECS-155)", () => {
  function selectionHarness() {
    let project: Project = createInitialProject("Test", 8);
    let target: FxTarget = "master";
    const dispatch = (action: Action) => {
      project = projectReducer(project, action);
    };
    const registry = createSequencerRegistry({
      getProject: () => project,
      getPatternId: () => project.patterns[0]!.id,
      dispatch,
      faderPageSize: 8,
      getTarget: () => target,
      selectTarget: (next) => {
        target = next;
      },
    });
    return {
      registry,
      dispatch,
      getProject: () => project,
      getTarget: () => target,
      // Simulates the app's own UI selecting a track directly (App.tsx's handleSelectTarget), bypassing
      // the registry's selectTarget dep entirely -- the real-world "Application -> Push" direction.
      setTargetFromUi: (next: FxTarget) => {
        target = next;
      },
    };
  }

  it("reports -1 while the target is master, and the track's position once one is selected", () => {
    const { registry, getTarget } = selectionHarness();
    const index = registry.getControl("selection.index")!;
    expect(getTarget()).toBe("master");
    expect(index.getValue()).toBe(-1);

    index.setValue(2);
    expect(getTarget()).toBe("track-3");
    expect(index.getValue()).toBe(2);
  });

  it("setting -1 selects master, the same thing clicking the mixer's Master strip does", () => {
    const { registry, getTarget } = selectionHarness();
    const index = registry.getControl("selection.index")!;
    index.setValue(0);
    expect(getTarget()).toBe("track-1");

    index.setValue(-1);
    expect(getTarget()).toBe("master");
  });

  it("a value past the track count is a no-op: it never falls back to selecting master", () => {
    const { registry, getTarget } = selectionHarness();
    const index = registry.getControl("selection.index")!;
    index.setValue(1);
    expect(getTarget()).toBe("track-2");

    index.setValue(99); // no track at position 99 on an 8-track project
    expect(getTarget()).toBe("track-2"); // unchanged -- not master, not anything else
  });

  it("follows a track selected directly in the app (not through MIDI): syncFromProject repaints the same control", () => {
    const { registry, getProject, setTargetFromUi } = selectionHarness();
    const index = registry.getControl("selection.index")!;
    const seen: number[] = [];
    index.onChange((value) => seen.push(value as number));

    // The app's own UI selected track-3 directly, with no device press involved at all --
    // useMidiControls.ts's [fxTarget] effect is what actually calls registry.syncFromProject() for
    // this in the real app; this harness calls it directly since there's no React effect here.
    setTargetFromUi("track-3");
    registry.syncFromProject(getProject());
    expect(seen).toEqual([2]);
    expect(index.getValue()).toBe(2);
  });

  it("is feedback-only without selectTarget: reading still works, but setValue does nothing", () => {
    let project: Project = createInitialProject("Test", 8);
    const registry = createSequencerRegistry({
      getProject: () => project,
      getPatternId: () => project.patterns[0]!.id,
      dispatch: (action) => {
        project = projectReducer(project, action);
      },
      faderPageSize: 8,
      getTarget: () => "track-1",
    });
    const index = registry.getControl("selection.index")!;
    expect(index.getValue()).toBe(0);
    index.setValue(3); // no selectTarget supplied: nothing to call, no throw
    expect(index.getValue()).toBe(0);
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
