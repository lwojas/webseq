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

import {
  createAction,
  type Action as MidiAction,
  type BooleanControlDef,
  type Control,
  type ControlDef,
  type ControlRegistry,
  type NumericControlDef,
  type StringControlDef,
} from "midi-core/control-api";
import type { SequencerContract } from "midi-core/configurations";
import { totalBeats, trackById } from "../model/types";
import type { ChainEntryId, Pattern, PatternId, Project, Track, TrackId } from "../model/types";
import type { Action } from "../model/reducer";
import { BANK_COUNT, BANK_SIZE, MAX_TRACK_VOLUME, MIN_TRACK_VOLUME, DEFAULT_TRACK_VOLUME } from "../model/project";
import { createTrackMutedControl, type ProjectControl } from "./controlAdapter";

export interface SequencerRegistryDeps {
  readonly getProject: () => Project;
  readonly getPatternId: () => PatternId;
  readonly dispatch: (action: Action) => void;
  /** The fader page: which group of the bank's tracks the faders show, 0-based (ECS-96). Omitted means page 0. */
  readonly getFaderPage?: () => number;
  /** The selected bank, 0-based. The faders drive that bank's 16 tracks only (ECS-113). Omitted means bank 0. */
  readonly getBank?: () => number;
  /** Selects a bank, 0-based (ECS-113). The application owns the bank; the device only asks for one. Omitted means no bank control can change it. */
  readonly setBank?: (bank: number) => void;
  /** How many tracks one fader page shows: the device's fader count, from midi-core's sequencerFaderCount (ECS-102). */
  readonly faderPageSize: number;
  /**
   * The transport's current position (ECS-131) — the same `Transport.getPlayheadInfo()` the on-screen playhead
   * already reads (see `App.tsx`'s `getPlayheadBeat`, `hooks/usePlayheadAnimation.ts`). Polled, not subscribed to:
   * this is the project's own established way of reading a continuously-advancing engine clock, reused as-is
   * rather than inventing a push-based source just for MIDI feedback. Omitted means no playhead feedback.
   */
  readonly getPlayhead?: () => { readonly patternId: PatternId | null; readonly beat: number };
  /**
   * Whether the transport is actually playing right now (ECS-131). `getPlayhead()` alone isn't enough: a stopped
   * or paused transport still reports a resting position (`Transport`'s own `pausedPosition`), which must not
   * light a pad — "leave the Launchpad in a sensible stopped state" is this check, not a sentinel `getPlayhead()`
   * has to invent. Omitted means never playing.
   */
  readonly isPlaying?: () => boolean;
  /**
   * The queue entry (project.patternChain) currently playing — `Transport.getCurrentChainEntryId()`.
   * `pattern.<n>.queued`'s setValue uses this to queue a pattern right after whatever's
   * actually sounding, via `deps.dispatch`, rather than at the end of the queue. Omitted means
   * `pattern.<n>.queued` controls are feedback-only.
   */
  readonly getCurrentChainEntryId?: () => ChainEntryId | null;
  /**
   * Selects `patternId` for editing — the same thing clicking its row in `PatternList`/its chip
   * in `PatternBar` does (`App.tsx`'s `setSelectedPatternId`). Omitted means `pattern.<n>.selected`
   * is feedback-only.
   */
  readonly selectPattern?: (patternId: PatternId) => void;
}

export interface SequencerRegistry extends ControlRegistry {
  syncFromProject(project: Project): void;
  /** Repaints every fader from its current track, after a fader page turn (ECS-96). */
  repaintFaders(): void;
  /**
   * Re-reads the playhead and fires its control's listeners if the column it resolves to moved (ECS-131). Meant
   * to be called from an animation-frame loop while connected — the same clock `usePlayheadAnimation` already
   * polls for the on-screen playhead, not a new timer of its own. A no-op until something has resolved
   * `transport.playhead` at least once (normal once a device's steps mode is bound), since this only re-syncs an
   * already-cached control, the same as `repaintFaders()` does for faders.
   */
  pollPlayhead(): void;
  /**
   * Re-reads the playing/queued pattern state and fires `pattern.<n>.playing`/`pattern.<n>.queued`/
   * `queue.<slot>.playing` listeners for any resolved control whose value moved — the manual-
   * launch counterpart to `pollPlayhead()` above, for the same reason: which pattern/queue entry
   * is sounding changes on the transport's own clock (a step boundary), not only on a Project
   * dispatch, so it needs the same animation-frame polling `pollPlayhead()` gets. The other new
   * pattern/queue controls (`.selected`, `.name`, `.bars`, `.pattern`, the `.count`/`.length`
   * pair) only ever change via a Project dispatch, so `syncFromProject()` alone already covers
   * them — no polling needed.
   */
  pollPatternLaunch(): void;
  /**
   * Resolves a fire-and-forget command by id (`pattern.<n>.duplicate`/`.delete`,
   * `patterns.create`, `queue.<slot>.remove`) — midi-core's `Action`, not a `Control`: these have
   * an effect but no persistent value to read back, so they don't fit `getControl`'s shape.
   * `ControlRegistry` (midi-core's base interface this extends) has no such lookup; this is a
   * webseq-only addition, same as `pollPatternLaunch`/`repaintFaders` already are. Resolved
   * fresh on every call rather than cached — an `Action` has no `onChange` state to preserve. */
  getAction(id: string): MidiAction | undefined;
}

const STEP_ID = /^step\.(\d+)\.(\d+)$/;
const STEP_DURATION_ID = /^step\.(\d+)\.(\d+)\.duration$/;
const MUTE_ID = /^mute\.(\d+)$/;
const FADER_VOLUME_ID = /^mixer\.volume\.(\d+)$/;
const LENGTH_ID = "steps.length";
const TRACKS_ID = "tracks.count";
const BANK_ID = "bank.active";
const PLAYHEAD_ID = "transport.playhead";
const PATTERN_PLAYING_ID = /^pattern\.(\d+)\.playing$/;
const PATTERN_QUEUED_ID = /^pattern\.(\d+)\.queued$/;
const PATTERN_SELECTED_ID = /^pattern\.(\d+)\.selected$/;
const PATTERN_NAME_ID = /^pattern\.(\d+)\.name$/;
const PATTERN_BARS_ID = /^pattern\.(\d+)\.bars$/;
const PATTERNS_COUNT_ID = "patterns.count";
const QUEUE_SLOT_PATTERN_ID = /^queue\.(\d+)\.pattern$/;
const QUEUE_SLOT_PLAYING_ID = /^queue\.(\d+)\.playing$/;
const QUEUE_LENGTH_ID = "queue.length";
const PATTERN_DUPLICATE_ID = /^pattern\.(\d+)\.duplicate$/;
const PATTERN_DELETE_ID = /^pattern\.(\d+)\.delete$/;
const PATTERNS_CREATE_ID = "patterns.create";
const QUEUE_SLOT_REMOVE_ID = /^queue\.(\d+)\.remove$/;

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

// step.<row>.<column>.duration (ECS-127): the note starting at that position's own length, in beats -- exactly
// midi-core's "how many cells this step's duration spans" unit, since a column here is one beat. Feedback-only:
// a pad's press toggles the note on/off (createStepControl above), never its length, so setValue is a no-op.
function createStepDurationControl(id: string, track: Track, start: number, deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = { id, label: `${track.id} step ${start + 1} duration`, kind: "number", min: 0, max: 1024, default: 0 };
  const duration = (project: Project) => {
    const pattern = selectedPattern(project, deps.getPatternId());
    const noteId = noteIdAt(pattern, track.id, start);
    return noteId === undefined ? 0 : pattern.notes[noteId]!.duration;
  };
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = duration(deps.getProject());

  return {
    def,
    getValue: () => duration(deps.getProject()),
    setValue: () => {},
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = duration(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

/**
 * transport.playhead (ECS-131): the virtual column currently playing, or -1 while nothing should light. -1 covers
 * both "not playing" (`deps.isPlaying()` false — a stopped or paused transport still reports a resting position,
 * which must not light a pad) and "playing a different pattern than this sequencer currently shows" (`patternId`
 * mismatch) — the same "hide rather than claim a position that isn't really here" rule `App.tsx`'s own
 * `getPlayheadBeat` already follows for the on-screen playhead. Feedback-only: nothing ever calls setValue.
 */
function playheadColumn(deps: SequencerRegistryDeps): number {
  if (!deps.isPlaying?.()) return -1;
  const info = deps.getPlayhead?.();
  if (!info || info.patternId !== deps.getPatternId()) return -1;
  return Math.floor(info.beat);
}

/** The currently-playing pattern id, or null while stopped/paused (ECS-117) — same "a resting
 * position must not look like a live one" rule as playheadColumn above, factored out because
 * createPatternPlayingControl needs it independent of any one sequencer's displayed pattern. */
function activePlayingPatternId(deps: SequencerRegistryDeps): PatternId | null {
  if (!deps.isPlaying?.()) return null;
  return deps.getPlayhead?.()?.patternId ?? null;
}

/**
 * pattern.<n>.playing (ECS-117): whether `project.patterns[index]` is the pattern currently
 * sounding. Feedback-only, same as the step/length/track-count controls above — there's no
 * sensible "set playing" write, only `transport.playhead`'s existing boundary-safe transitions.
 */
function createPatternPlayingControl(index: number, deps: SequencerRegistryDeps): ProjectControl<BooleanControlDef> {
  const def: BooleanControlDef = { id: `pattern.${index}.playing`, label: `Pattern ${index + 1} playing`, kind: "boolean", default: false };
  const isPlaying = (project: Project) => project.patterns[index]?.id === activePlayingPatternId(deps);
  const listeners = new Set<(value: boolean, previous: boolean) => void>();
  let last = isPlaying(deps.getProject());

  return {
    def,
    getValue: () => isPlaying(deps.getProject()),
    setValue: () => {},
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = isPlaying(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

/**
 * pattern.<n>.queued: whether `project.patterns[index]` is in the pattern queue
 * (project.patternChain) other than as the single currently-playing entry — true for anything
 * queued to play next or later in the loop. Unlike playing, this one is also writable: setting
 * it true queues that pattern right after whatever's currently playing, setting it false
 * removes every one of its queue entries (refused by the reducer if that would empty the
 * queue) — the same "a pad is both feedback and input" shape `mute.<n>` already has.
 */
function createPatternQueuedControl(index: number, deps: SequencerRegistryDeps): ProjectControl<BooleanControlDef> {
  const def: BooleanControlDef = { id: `pattern.${index}.queued`, label: `Pattern ${index + 1} queued`, kind: "boolean", default: false };
  const isQueued = (project: Project) => {
    const pattern = project.patterns[index];
    if (!pattern) return false;
    return project.patternChain.some((e) => e.patternId === pattern.id) && pattern.id !== activePlayingPatternId(deps);
  };
  const listeners = new Set<(value: boolean, previous: boolean) => void>();
  let last = isQueued(deps.getProject());

  return {
    def,
    getValue: () => isQueued(deps.getProject()),
    setValue(value) {
      const pattern = deps.getProject().patterns[index];
      if (!pattern) return;
      if (value) deps.dispatch({ type: "QUEUE_PATTERN_NEXT", patternId: pattern.id, afterEntryId: deps.getCurrentChainEntryId?.() ?? null });
      else deps.dispatch({ type: "REMOVE_FROM_QUEUE", patternId: pattern.id });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = isQueued(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

/**
 * pattern.<n>.selected: whether `project.patterns[index]` is the one selected for editing
 * (`App.tsx`'s `selectedPatternId`) — independent of playing/queued, same separation `PatternBar`/
 * `PatternList` already keep. Writable: `setValue(true)` selects it (the same action clicking its
 * row does); `setValue(false)` is a no-op, since there's always exactly one selected pattern and
 * no "deselect" affordance anywhere in the UI either.
 */
function createPatternSelectedControl(index: number, deps: SequencerRegistryDeps): ProjectControl<BooleanControlDef> {
  const def: BooleanControlDef = { id: `pattern.${index}.selected`, label: `Pattern ${index + 1} selected`, kind: "boolean", default: false };
  const isSelected = (project: Project) => project.patterns[index]?.id === deps.getPatternId();
  const listeners = new Set<(value: boolean, previous: boolean) => void>();
  let last = isSelected(deps.getProject());

  return {
    def,
    getValue: () => isSelected(deps.getProject()),
    setValue(value) {
      if (!value) return;
      const pattern = deps.getProject().patterns[index];
      if (pattern) deps.selectPattern?.(pattern.id);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = isSelected(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

/**
 * pattern.<n>.name: `project.patterns[index]`'s display name. Read-only — the first real
 * consumer of `StringControlDef` in this app, for exactly the use case that control kind was
 * built for (midi-core's doc comment: "the current pattern name shown on a device's LCD").
 */
function createPatternNameControl(index: number, deps: SequencerRegistryDeps): ProjectControl<StringControlDef> {
  const def: StringControlDef = { id: `pattern.${index}.name`, label: `Pattern ${index + 1} name`, kind: "string", default: "" };
  const name = (project: Project) => project.patterns[index]?.name ?? "";
  const listeners = new Set<(value: string, previous: string) => void>();
  let last = name(deps.getProject());

  return {
    def,
    getValue: () => name(deps.getProject()),
    setValue: () => {},
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = name(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

/** pattern.<n>.bars: `project.patterns[index]`'s bar count. Writable, same bounds as `PatternBar`/`PatternList`'s own bars input. */
function createPatternBarsControl(index: number, deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = { id: `pattern.${index}.bars`, label: `Pattern ${index + 1} bars`, kind: "number", min: 1, max: 64, default: 1 };
  const bars = (project: Project) => project.patterns[index]?.bars ?? def.default;
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = bars(deps.getProject());

  return {
    def,
    getValue: () => bars(deps.getProject()),
    setValue(value) {
      const pattern = deps.getProject().patterns[index];
      if (pattern) deps.dispatch({ type: "SET_PATTERN_BARS", patternId: pattern.id, bars: value });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = bars(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

/** patterns.count: how many patterns exist, so a caller can bound its own pattern-pad iteration -- same role `tracks.count` already plays for the step grid. */
function createPatternsCountControl(deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = { id: PATTERNS_COUNT_ID, label: "Pattern count", kind: "number", min: 0, max: 1024, default: 0 };
  const count = (project: Project) => project.patterns.length;
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
 * queue.<slot>.pattern: the name of whichever pattern occupies that position in the queue
 * (project.patternChain — see its doc comment), 0-based. Separate from pattern.<n>.name since a
 * pattern can occupy more than one slot. Empty string past the queue's current length or for a
 * dangling entry (its pattern deleted -- shouldn't normally happen, removePattern already cleans
 * the queue, but this stays safe rather than throwing either way).
 */
function createQueueSlotPatternControl(slot: number, deps: SequencerRegistryDeps): ProjectControl<StringControlDef> {
  const def: StringControlDef = { id: `queue.${slot}.pattern`, label: `Queue slot ${slot + 1} pattern`, kind: "string", default: "" };
  const name = (project: Project) => {
    const entry = project.patternChain[slot];
    if (!entry) return "";
    return project.patterns.find((p) => p.id === entry.patternId)?.name ?? "";
  };
  const listeners = new Set<(value: string, previous: string) => void>();
  let last = name(deps.getProject());

  return {
    def,
    getValue: () => name(deps.getProject()),
    setValue: () => {},
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = name(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

/**
 * queue.<slot>.playing: whether that exact queue slot is the entry currently sounding
 * (Transport.getCurrentChainEntryId()) -- entry-level, not pattern-level, so two slots holding
 * the same pattern are told apart correctly (pattern.<n>.playing can't do that on its own).
 */
function createQueueSlotPlayingControl(slot: number, deps: SequencerRegistryDeps): ProjectControl<BooleanControlDef> {
  const def: BooleanControlDef = { id: `queue.${slot}.playing`, label: `Queue slot ${slot + 1} playing`, kind: "boolean", default: false };
  const isPlaying = (project: Project) => {
    const entry = project.patternChain[slot];
    if (!entry || !deps.isPlaying?.()) return false;
    return entry.id === (deps.getCurrentChainEntryId?.() ?? null);
  };
  const listeners = new Set<(value: boolean, previous: boolean) => void>();
  let last = isPlaying(deps.getProject());

  return {
    def,
    getValue: () => isPlaying(deps.getProject()),
    setValue: () => {},
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = isPlaying(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

/** queue.length: how many entries are actually in the queue right now, so a caller can bound its own queue-slot iteration -- same role patterns.count plays for the pattern library. */
function createQueueLengthControl(deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = { id: QUEUE_LENGTH_ID, label: "Queue length", kind: "number", min: 0, max: 1024, default: 0 };
  const length = (project: Project) => project.patternChain.length;
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = length(deps.getProject());

  return {
    def,
    getValue: () => length(deps.getProject()),
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

function createPlayheadControl(deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = { id: PLAYHEAD_ID, label: "Playhead", kind: "number", min: -1, max: 1024, default: -1 };
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = playheadColumn(deps);

  return {
    def,
    getValue: () => playheadColumn(deps),
    setValue: () => {},
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Ignores its `project` argument: the playhead moves from the transport's clock, not from project edits. Called
    // from the same places createBankControl's own project-argument-ignoring sync already is, plus pollPlayhead()
    // below for the per-frame case neither a project change nor a bank change covers.
    syncFromProject() {
      const next = playheadColumn(deps);
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

// The active bank (ECS-113). Its value is the selected bank index, so a device can light the button of the bank on screen. Setting it
// selects that bank; a value outside A-D is clamped to the nearest bank. The bank is view state: setting it changes no track.
function createBankControl(deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = { id: BANK_ID, label: "Active bank", kind: "number", min: 0, max: BANK_COUNT - 1, default: 0 };
  const bank = () => deps.getBank?.() ?? 0;
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = bank();

  return {
    def,
    getValue: bank,
    setValue(value) {
      deps.setBank?.(Math.min(BANK_COUNT - 1, Math.max(0, Math.round(value))));
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject() {
      const next = bank();
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

/** Pages one bank needs for a device with `faderPageSize` faders: 16 tracks on 8 faders is 2 pages, on 4 faders 4 pages. */
export function faderPagesPerBank(faderPageSize: number): number {
  return faderPageSize <= 0 ? 1 : Math.ceil(BANK_SIZE / faderPageSize);
}

/**
 * The project track index that fader `index` drives: `bank * BANK_SIZE + page * faderPageSize + index` (ECS-113). Faders only
 * reach within the selected bank, so a fader past the bank's last track (possible when the fader count doesn't divide 16) has
 * no track and returns undefined.
 */
export function faderTrackIndex(bank: number, page: number, index: number, faderPageSize: number): number | undefined {
  if (faderPageSize <= 0) return undefined;
  const withinBank = page * faderPageSize + index;
  if (withinBank >= BANK_SIZE) return undefined;
  return bank * BANK_SIZE + withinBank;
}

/**
 * The volume fader at `index` (below the device's fader count) on the current fader page (ECS-96): fader `index` shows and
 * sets the volume of the track `faderTrackIndex` gives for the selected bank and page (ECS-102, ECS-113). A fader with no track
 * reads 0, which is the device's off colour, and ignores writes.
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
  const track = (project: Project) => {
    const trackIndex = faderTrackIndex(deps.getBank?.() ?? 0, deps.getFaderPage?.() ?? 0, index, deps.faderPageSize);
    return trackIndex === undefined ? undefined : project.tracks[trackIndex];
  };
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

/**
 * The bank actions a device's bank buttons invoke (ECS-114): previous and next step through A-D and stop at the ends, and
 * select[n] selects bank n (0 = A). A bank change only moves the view: it changes no track's level or mute (ECS-113).
 */
export function createBankActions(getBank: () => number, setBank: (bank: number) => void): NonNullable<SequencerContract["bankActions"]> {
  const clamp = (bank: number) => Math.min(BANK_COUNT - 1, Math.max(0, bank));
  const select: Record<number, ReturnType<typeof createAction>> = {};
  for (let index = 0; index < BANK_COUNT; index++) {
    const letter = String.fromCharCode("A".charCodeAt(0) + index);
    select[index] = createAction({ id: `bank.select.${letter}`, label: `Bank ${letter}` }, () => setBank(index));
  }
  return {
    previous: createAction({ id: "bank.previous", label: "Previous bank" }, () => setBank(clamp(getBank() - 1))),
    next: createAction({ id: "bank.next", label: "Next bank" }, () => setBank(clamp(getBank() + 1))),
    select,
  };
}

/**
 * Resolves a fire-and-forget pattern/queue command by id against the live project -- the
 * `getAction` counterpart to `resolve()`'s controls below. A command whose index/slot is out of
 * range (or, for the two delete-ish ones, whose target no longer exists by the time it's
 * actually invoked) resolves to `undefined`/is a harmless no-op, same bounds-checking and
 * never-empty-queue guards the Patterns view's own buttons already respect.
 */
function resolveAction(id: string, deps: SequencerRegistryDeps): MidiAction | undefined {
  const project = deps.getProject();
  const duplicate = PATTERN_DUPLICATE_ID.exec(id);
  const del = PATTERN_DELETE_ID.exec(id);
  const queueRemove = QUEUE_SLOT_REMOVE_ID.exec(id);

  if (duplicate && project.patterns[Number(duplicate[1])]) {
    const index = Number(duplicate[1]);
    return createAction({ id, label: `Duplicate pattern ${index + 1}` }, () => {
      const pattern = deps.getProject().patterns[index];
      if (pattern) deps.dispatch({ type: "DUPLICATE_PATTERN", patternId: pattern.id });
    });
  }
  if (del && project.patterns[Number(del[1])]) {
    const index = Number(del[1]);
    return createAction({ id, label: `Delete pattern ${index + 1}` }, () => {
      const pattern = deps.getProject().patterns[index];
      if (pattern) deps.dispatch({ type: "REMOVE_PATTERN", patternId: pattern.id });
    });
  }
  if (id === PATTERNS_CREATE_ID) {
    return createAction({ id, label: "Create pattern" }, () => deps.dispatch({ type: "ADD_PATTERN" }));
  }
  if (queueRemove && project.patternChain[Number(queueRemove[1])]) {
    const slot = Number(queueRemove[1]);
    return createAction({ id, label: `Remove queue slot ${slot + 1}` }, () => {
      const entry = deps.getProject().patternChain[slot];
      if (entry) deps.dispatch({ type: "REMOVE_CHAIN_ENTRY", entryId: entry.id });
    });
  }
  return undefined;
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
    const stepDuration = STEP_DURATION_ID.exec(id);
    const mute = MUTE_ID.exec(id);
    if (step) {
      const track = project.tracks[Number(step[1])];
      const column = Number(step[2]);
      if (track && column < totalBeats(selectedPattern(project, deps.getPatternId()), project.beatsPerBar)) {
        created = createStepControl(id, track, column, deps);
      }
    } else if (stepDuration) {
      const track = project.tracks[Number(stepDuration[1])];
      const column = Number(stepDuration[2]);
      if (track && column < totalBeats(selectedPattern(project, deps.getPatternId()), project.beatsPerBar)) {
        created = createStepDurationControl(id, track, column, deps) as ProjectControl<ControlDef>;
      }
    } else if (mute) {
      const track = project.tracks[Number(mute[1]) - 1];
      if (track) created = liveMuteControl(track.id, deps) as ProjectControl<ControlDef>;
    } else if (id === LENGTH_ID) {
      created = createLengthControl(deps) as ProjectControl<ControlDef>;
    } else if (id === TRACKS_ID) {
      created = createTrackCountControl(deps) as ProjectControl<ControlDef>;
    } else if (id === BANK_ID) {
      created = createBankControl(deps) as ProjectControl<ControlDef>;
    } else if (id === PLAYHEAD_ID) {
      created = createPlayheadControl(deps) as ProjectControl<ControlDef>;
    } else if (id === PATTERNS_COUNT_ID) {
      created = createPatternsCountControl(deps) as ProjectControl<ControlDef>;
    } else if (id === QUEUE_LENGTH_ID) {
      created = createQueueLengthControl(deps) as ProjectControl<ControlDef>;
    } else {
      const fader = FADER_VOLUME_ID.exec(id);
      const patternPlaying = PATTERN_PLAYING_ID.exec(id);
      const patternQueued = PATTERN_QUEUED_ID.exec(id);
      const patternSelected = PATTERN_SELECTED_ID.exec(id);
      const patternName = PATTERN_NAME_ID.exec(id);
      const patternBars = PATTERN_BARS_ID.exec(id);
      const queueSlotPattern = QUEUE_SLOT_PATTERN_ID.exec(id);
      const queueSlotPlaying = QUEUE_SLOT_PLAYING_ID.exec(id);
      // A fader exists only within the device's page (ECS-102): mixer.volume.<index> for an index below the page size.
      if (fader && Number(fader[1]) < deps.faderPageSize) {
        created = createFaderVolumeControl(Number(fader[1]), deps) as ProjectControl<ControlDef>;
      } else if (patternPlaying && project.patterns[Number(patternPlaying[1])]) {
        created = createPatternPlayingControl(Number(patternPlaying[1]), deps) as ProjectControl<ControlDef>;
      } else if (patternQueued && project.patterns[Number(patternQueued[1])]) {
        created = createPatternQueuedControl(Number(patternQueued[1]), deps) as ProjectControl<ControlDef>;
      } else if (patternSelected && project.patterns[Number(patternSelected[1])]) {
        created = createPatternSelectedControl(Number(patternSelected[1]), deps) as ProjectControl<ControlDef>;
      } else if (patternName && project.patterns[Number(patternName[1])]) {
        created = createPatternNameControl(Number(patternName[1]), deps) as ProjectControl<ControlDef>;
      } else if (patternBars && project.patterns[Number(patternBars[1])]) {
        created = createPatternBarsControl(Number(patternBars[1]), deps) as ProjectControl<ControlDef>;
      } else if (queueSlotPattern && project.patternChain[Number(queueSlotPattern[1])]) {
        created = createQueueSlotPatternControl(Number(queueSlotPattern[1]), deps) as ProjectControl<ControlDef>;
      } else if (queueSlotPlaying && project.patternChain[Number(queueSlotPlaying[1])]) {
        created = createQueueSlotPlayingControl(Number(queueSlotPlaying[1]), deps) as ProjectControl<ControlDef>;
      }
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
    pollPlayhead() {
      (resolve(PLAYHEAD_ID) as ProjectControl<ControlDef> | undefined)?.syncFromProject(deps.getProject());
    },
    pollPatternLaunch() {
      const project = deps.getProject();
      for (const [id, control] of cache) {
        if (PATTERN_PLAYING_ID.test(id) || PATTERN_QUEUED_ID.test(id) || QUEUE_SLOT_PLAYING_ID.test(id)) control.syncFromProject(project);
      }
    },
    getAction: (id) => resolveAction(id, deps),
  };
}
