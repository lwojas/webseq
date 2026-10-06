// The sequencer's side of the Launchpad contract (ECS-89 gap 4): it names its controls with the ids a midi-core
// SequencerContract expects -- step.<row>.<column>, mute.<track>, steps.length -- and nothing about devices.
// Which device control drives which of these lives in midi-core's configuration, not here.
//
// Rows are tracks (row 0 is the first track), columns are beats of the selected pattern. A step is on when a
// note starts on that track at that beat; toggling it adds or removes that note through the reducer.
//
// Controls are resolved by id on demand, so a sequence longer than one page needs no fixed list of controls.
// Each resolved control is cached, and syncFromProject() keeps every cached control's change notifications
// in step with the project, the same way controlAdapter.ts's ProjectControl already does for track mutes.

import type { BooleanControlDef, Control, ControlDef, ControlRegistry, NumericControlDef } from "midi-core/control-api";
import { totalBeats, trackById } from "../model/types";
import type { Pattern, PatternId, Project, Track, TrackId } from "../model/types";
import type { Action } from "../model/reducer";
import { MAX_TRACK_VOLUME, MIN_TRACK_VOLUME, DEFAULT_TRACK_VOLUME } from "../model/project";
import { createTrackMutedControl, type ProjectControl } from "./controlAdapter";

export interface SequencerRegistryDeps {
  readonly getProject: () => Project;
  readonly getPatternId: () => PatternId;
  readonly dispatch: (action: Action) => void;
  /** The fader page: which group of eight tracks the mixer faders show, 0-based (ECS-96). Omitted means page 0. */
  readonly getFaderPage?: () => number;
}

export interface SequencerRegistry extends ControlRegistry {
  syncFromProject(project: Project): void;
  /** Repaints every fader from its current track, after a fader page turn (ECS-96). */
  repaintFaders(): void;
}

const STEP_ID = /^step\.(\d+)\.(\d+)$/;
const MUTE_ID = /^mute\.(\d+)$/;
const FADER_VOLUME_ID = /^mixer\.volume\.([0-7])$/;
/** How many tracks one fader bank shows: a page is eight tracks, one per fader (ECS-96). */
export const FADER_PAGE_SIZE = 8;
const LENGTH_ID = "steps.length";
const TRACKS_ID = "tracks.count";

function selectedPattern(project: Project, patternId: PatternId): Pattern {
  return project.patterns.find((pattern) => pattern.id === patternId) ?? project.patterns[0]!;
}

function noteIdAt(pattern: Pattern, trackId: TrackId, start: number) {
  return Object.values(pattern.notes).find((note) => note.trackId === trackId && note.start === start)?.id;
}

function createStepControl(id: string, track: Track, start: number, deps: SequencerRegistryDeps): ProjectControl<BooleanControlDef> {
  const def: BooleanControlDef = { id, label: `${track.id} step ${start + 1}`, kind: "boolean", default: false };
  const isOn = (project: Project) => noteIdAt(selectedPattern(project, deps.getPatternId()), track.id, start) !== undefined;
  const listeners = new Set<(value: boolean, previous: boolean) => void>();
  let last = isOn(deps.getProject());

  return {
    def,
    getValue: () => isOn(deps.getProject()),
    setValue(value) {
      const project = deps.getProject();
      const pattern = selectedPattern(project, deps.getPatternId());
      const existing = noteIdAt(pattern, track.id, start);
      if (value && existing === undefined) deps.dispatch({ type: "ADD_NOTE", patternId: pattern.id, trackId: track.id, start });
      if (!value && existing !== undefined) deps.dispatch({ type: "REMOVE_NOTE", patternId: pattern.id, noteId: existing });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = isOn(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

// createTrackMutedControl reports its cached value, which only updates on sync. A toggle reads the value it is about to
// flip, so a read here must reflect the project as it is now, not as of the last sync.
function liveMuteControl(trackId: TrackId, deps: SequencerRegistryDeps): ProjectControl<BooleanControlDef> {
  const control = createTrackMutedControl(trackId, deps.getProject, deps.dispatch);
  return { ...control, getValue: () => trackById(deps.getProject(), trackId)?.muted ?? false };
}

function createLengthControl(deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = { id: LENGTH_ID, label: "Sequence length (beats)", kind: "number", min: 0, max: 1024, default: 0 };
  const length = (project: Project) => totalBeats(selectedPattern(project, deps.getPatternId()), project.beatsPerBar);
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = length(deps.getProject());

  return {
    def,
    getValue: () => length(deps.getProject()),
    // The sequence length follows the selected pattern; the application changes it, not the device.
    setValue: () => {},
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = length(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

// The track count follows the project. Vertical paging stops at its end (midi-core ECS-95); the application changes it, not the device.
function createTrackCountControl(deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = { id: TRACKS_ID, label: "Track count", kind: "number", min: 0, max: 1024, default: 0 };
  const count = (project: Project) => project.tracks.length;
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = count(deps.getProject());

  return {
    def,
    getValue: () => count(deps.getProject()),
    setValue: () => {},
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = count(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

/**
 * The volume fader at `index` (0-7) on the current fader page (ECS-96): fader `index` shows and sets the volume of track
 * `page * 8 + index`. A fader with no track on the page reads 0, which is the device's off colour, and ignores writes.
 * The track's volume is the application's own linear gain (0 to 1.5), so midi-core scales the CC range onto it.
 */
type FaderVolumeControl = ProjectControl<NumericControlDef> & { repaint(): void };

function createFaderVolumeControl(index: number, deps: SequencerRegistryDeps): FaderVolumeControl {
  const def: NumericControlDef = {
    id: `mixer.volume.${index}`,
    label: `Volume, fader ${index + 1}`,
    kind: "number",
    min: MIN_TRACK_VOLUME,
    max: MAX_TRACK_VOLUME,
    default: DEFAULT_TRACK_VOLUME,
  };
  const track = (project: Project) => project.tracks[(deps.getFaderPage?.() ?? 0) * FADER_PAGE_SIZE + index];
  const read = (project: Project) => track(project)?.volume ?? 0;
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = read(deps.getProject());

  return {
    def,
    getValue: () => read(deps.getProject()),
    setValue(value) {
      const current = track(deps.getProject());
      if (current) deps.dispatch({ type: "SET_TRACK_VOLUME", trackId: current.id, volume: value });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Called on every project change, so the fader's colour follows its track.
    syncFromProject(project) {
      const next = read(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
    // Called on a page turn: the device has been sent its bank again and forgot its colours, so every fader repaints
    // even when its own level happens to be unchanged.
    repaint() {
      const next = read(deps.getProject());
      last = next;
      for (const listener of listeners) listener(next, next);
    },
  };
}

/** A registry that resolves the sequencer's contract ids against the live project. */
export function createSequencerRegistry(deps: SequencerRegistryDeps): SequencerRegistry {
  const cache = new Map<string, ProjectControl<ControlDef>>();

  function resolve(id: string): Control<ControlDef> | undefined {
    const cached = cache.get(id);
    if (cached) return cached;

    const project = deps.getProject();
    let created: ProjectControl<ControlDef> | undefined;
    const step = STEP_ID.exec(id);
    const mute = MUTE_ID.exec(id);
    if (step) {
      const track = project.tracks[Number(step[1])];
      const column = Number(step[2]);
      if (track && column < totalBeats(selectedPattern(project, deps.getPatternId()), project.beatsPerBar)) {
        created = createStepControl(id, track, column, deps);
      }
    } else if (mute) {
      const track = project.tracks[Number(mute[1]) - 1];
      if (track) created = liveMuteControl(track.id, deps) as ProjectControl<ControlDef>;
    } else if (id === LENGTH_ID) {
      created = createLengthControl(deps) as ProjectControl<ControlDef>;
    } else if (id === TRACKS_ID) {
      created = createTrackCountControl(deps) as ProjectControl<ControlDef>;
    } else {
      const fader = FADER_VOLUME_ID.exec(id);
      if (fader) created = createFaderVolumeControl(Number(fader[1]), deps) as ProjectControl<ControlDef>;
    }

    if (created) cache.set(id, created);
    return created;
  }

  return {
    listControls: () => [...cache.values()],
    getControl: resolve,
    onChange: () => () => {},
    syncFromProject(project) {
      for (const control of cache.values()) control.syncFromProject(project);
    },
    repaintFaders() {
      for (const [id, control] of cache) {
        if (FADER_VOLUME_ID.test(id)) (control as FaderVolumeControl).repaint();
      }
    },
  };
}
