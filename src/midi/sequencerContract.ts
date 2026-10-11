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
import { totalBeats, trackById, fxOwner } from "../model/types";
import type { ChainEntryId, FxId, FxInstance, FxTarget, Pattern, PatternId, Project, Track, TrackId } from "../model/types";
import { FX_DEFS } from "../model/fx";
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
  /**
   * The FX target whose chain the `fx.*` controls below expose (ECS-149) — `App.tsx`'s
   * `selectedTarget`, the same track-or-"master" scoping the FX panel itself already shows one of
   * at a time. Omitted means no `fx.*` control resolves — there's no chain to address.
   *
   * ECS-155: also the thing `selection.index` reads to resolve midi-core's generic selected index back to a
   * track (or "master") — the app has exactly one notion of "what's currently selected," not a separate
   * MIDI-only one, so a device's contextual selection buttons and the FX panel always agree.
   */
  readonly getTarget?: () => FxTarget;
  /**
   * Selects `target` as the app's FX/selection target (ECS-155) — the same thing clicking a track row (or
   * the mixer's Master strip) does (`App.tsx`'s `handleSelectTarget`). Omitted means `selection.index` is
   * feedback-only: MIDI Core can still read the current selection, but a device's contextual selection
   * buttons (and its Master/clear button) do nothing.
   */
  readonly selectTarget?: (target: FxTarget) => void;
  /**
   * The FX currently selected for editing within that target's chain (ECS-149) — `App.tsx`'s
   * `selectedFxId`. Omitted means `fx.selected.*` always reports "nothing selected" and
   * `fx.<n>.selected` is always false.
   */
  readonly getSelectedFxId?: () => FxId | null;
  /**
   * Selects `fxId` within the current target's chain for editing — the same thing clicking its
   * chip in `FxChainStrip` does (`App.tsx`'s `setSelectedFxId`). Omitted means `fx.<n>.selected`/
   * `fx.selected.*`/`fx.next`/`fx.previous` are feedback-only.
   */
  readonly selectFx?: (fxId: FxId) => void;
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
const STEP_COVERED_ID = /^step\.(\d+)\.(\d+)\.covered$/;
const MUTE_ID = /^mute\.(\d+)$/;
const FADER_VOLUME_ID = /^mixer\.volume\.(\d+)$/;
const LENGTH_ID = "steps.length";
const TRACKS_ID = "tracks.count";
const BANK_ID = "bank.active";
const SELECTION_INDEX_ID = "selection.index";
/** ECS-155: the value `selection.index` holds while the FX/selection target is "master" — matches midi-core's own `selectionClearValue`. */
const SELECTION_NO_TARGET = -1;
const PLAYHEAD_ID = "transport.playhead";
const IS_PLAYING_ID = "transport.isPlaying";
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

// FX (ECS-149). All position-indexed by `fx.<n>.*` resolve against the currently selected
// target's chain (deps.getTarget()), in chain order -- the FX panel only ever shows one target's
// chain at a time, the same scoping step.<row>.<column> already gets from the selected pattern.
// The `fx.selected.*` ids are a second, index-independent way to reach exactly the same data --
// whichever FX `fx.<n>.selected`/fx.next/fx.previous (or the UI) most recently selected -- so a
// device with a fixed encoder bank (e.g. Push mk1) can bind straight to "the selected FX's
// parameters" without resolving which index is currently selected itself, the same reason
// transport.playhead/transport.isPlaying exist as fixed ids alongside step.<row>.<column>'s grid
// addressing.
const FX_COUNT_ID = "fx.count";
const FX_ENABLED_ID = /^fx\.(\d+)\.enabled$/;
const FX_SELECTED_ID = /^fx\.(\d+)\.selected$/;
const FX_NAME_ID = /^fx\.(\d+)\.name$/;
const FX_PARAMS_COUNT_ID = /^fx\.(\d+)\.params\.count$/;
const FX_PARAM_ID = /^fx\.(\d+)\.param\.(\d+)$/;
const FX_SELECTED_INDEX_ID = "fx.selected.index";
const FX_SELECTED_ENABLED_ID = "fx.selected.enabled";
const FX_SELECTED_NAME_ID = "fx.selected.name";
const FX_SELECTED_PARAMS_COUNT_ID = "fx.selected.params.count";
const FX_SELECTED_PARAM_ID = /^fx\.selected\.param\.(\d+)$/;
const FX_NEXT_ID = "fx.next";
const FX_PREVIOUS_ID = "fx.previous";

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
  const label = `${track.id} step ${start + 1} duration`;
  const duration = (project: Project) => {
    const pattern = selectedPattern(project, deps.getPatternId());
    const noteId = noteIdAt(pattern, track.id, start);
    return noteId === undefined ? 0 : pattern.notes[noteId]!.duration;
  };
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = duration(deps.getProject());

  return {
    // A getter, not a fixed `max: 1024` (ECS-152): `max` bounds midi-core's duration-
    // continuation backward scan (bindStepFeedback's `lookback()`, `sample.def.max - 1`), and a
    // note can never be longer than its *own* pattern -- so the current pattern's actual length
    // is always a safe, correct bound, just a far tighter one than the worst case across every
    // pattern this project could ever hold (64 bars, matching the fixed 1024 this replaces).
    // Recomputed on every access rather than once at creation so it can never go stale as the
    // pattern's own length changes later (adding/removing bars) -- unlike a plain stored field,
    // which this control (like every other one here) is cached and reused across many ticks.
    // Measured at 128 beats for a realistic project versus the 1024 ceiling: roughly an 8x
    // reduction in how far every pad on the grid rescans on each playhead tick.
    get def(): NumericControlDef {
      const project = deps.getProject();
      const pattern = selectedPattern(project, deps.getPatternId());
      return { id, label, kind: "number", min: 0, max: Math.max(1, totalBeats(pattern, project.beatsPerBar)), default: 0 };
    },
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
 * step.<row>.<column>.covered (ECS-153): whether an earlier note on this track reaches forward across this
 * position, already resolved here from `pattern.notes` -- a flat, already-indexed `{start, duration}` list, cheap
 * to scan directly -- instead of midi-core having to re-derive it one registry query at a time via
 * `step.{row}.{column}.duration`'s backward scan (`bindStepFeedback`'s `lookback()`). Deliberately does not also
 * exclude "a note starts exactly here": midi-core's own `paint()` always checks this cell's `step.{row}.{column}`
 * first and never consults this control when that's true, the same precedence the duration scan already had, so
 * there's nothing to gain from duplicating that exclusion here. Feedback-only, same as
 * createStepDurationControl above -- a pad's press only ever toggles its own step.{row}.{column}.
 */
function createStepCoveredControl(id: string, track: Track, start: number, deps: SequencerRegistryDeps): ProjectControl<BooleanControlDef> {
  const def: BooleanControlDef = { id, label: `${track.id} step ${start + 1} covered`, kind: "boolean", default: false };
  const covered = (project: Project) => {
    const pattern = selectedPattern(project, deps.getPatternId());
    return Object.values(pattern.notes).some((note) => note.trackId === track.id && note.start < start && note.start + note.duration > start);
  };
  const listeners = new Set<(value: boolean, previous: boolean) => void>();
  let last = covered(deps.getProject());

  return {
    def,
    getValue: () => covered(deps.getProject()),
    setValue: () => {},
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = covered(project);
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

/**
 * transport.isPlaying (ECS-145 follow-up): `1` while the transport is actually playing, `0` otherwise -- a plain
 * numeric mirror of `deps.isPlaying()` for midi-core's `IndicatorBinding` (which matches a number against a `lit`
 * value, not a boolean) to drive the device's Play button LED persistently. Same "moves from the transport's
 * clock, not from project edits" ignored-`project`-argument shape as createPlayheadControl above, and synced from
 * the same per-frame poll, not a second clock of its own.
 */
function createIsPlayingControl(deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = { id: IS_PLAYING_ID, label: "Transport is playing", kind: "number", min: 0, max: 1, default: 0 };
  const value = () => (deps.isPlaying?.() ? 1 : 0);
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = value();

  return {
    def,
    getValue: value,
    setValue: () => {},
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject() {
      const next = value();
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

/**
 * selection.index (ECS-155): the 0-based position of the selected track within `project.tracks`, or
 * `SELECTION_NO_TARGET` (-1) while the FX/selection target is "master" (or names a track that no longer
 * exists). This is midi-core's one generic, writable "which item is selected" control — it resolves against
 * the *same* `selectedTarget`/`FxTarget` state the FX panel already owns (`deps.getTarget`/`deps.selectTarget`),
 * never a second, MIDI-only selection. midi-core itself never learns "track" or "master": it only ever moves
 * this index in and out, via its own contextual selection buttons and Master/clear button.
 *
 * Writable: `setValue(n)` selects `project.tracks[n]` as the target (the same thing clicking its row does),
 * or switches to "master" when `n` is exactly `SELECTION_NO_TARGET`. A value naming no track at all — e.g. a
 * contextual selection button pressed past the application's actual track count, which midi-core still
 * writes even though that slot renders "unavailable" — is a no-op: selecting nothing must not silently fall
 * back to selecting master.
 */
function createSelectionIndexControl(deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = {
    id: SELECTION_INDEX_ID,
    label: "Selected item index",
    kind: "number",
    min: SELECTION_NO_TARGET,
    max: 1024,
    default: SELECTION_NO_TARGET,
  };
  const index = (project: Project) => {
    const target = deps.getTarget?.();
    if (!target || target === "master") return SELECTION_NO_TARGET;
    return project.tracks.findIndex((track) => track.id === target);
  };
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = index(deps.getProject());

  return {
    def,
    getValue: () => index(deps.getProject()),
    setValue(value) {
      const track = deps.getProject().tracks[value];
      if (track) deps.selectTarget?.(track.id);
      else if (value === SELECTION_NO_TARGET) deps.selectTarget?.("master");
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = index(project);
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

/** The currently selected target's FX chain, in order, or empty if `getTarget` is unset or the
 * target no longer exists (e.g. its track was deleted) -- the one place that needs to branch on
 * FxTarget for every fx.* control below, same role `selectedPattern` plays for step.*. */
function currentFxChain(deps: SequencerRegistryDeps, project: Project): readonly FxInstance[] {
  const target = deps.getTarget?.();
  if (!target) return [];
  return fxOwner(project, target)?.fx ?? [];
}

/** Resolves which FxInstance a given fx.* control reads/writes, against a specific project
 * snapshot -- a plain function rather than a cached reference, so it always reflects FX being
 * added, removed, enabled/bypassed, or (re)selected, never a stale instance. */
type FxLocator = (project: Project) => FxInstance | undefined;

function fxByIndex(index: number, deps: SequencerRegistryDeps): FxLocator {
  return (project) => currentFxChain(deps, project)[index];
}

/** ECS-149: whichever FX `deps.getSelectedFxId()` currently names, within the current target's
 * chain -- undefined while nothing is selected, or while the selected id no longer belongs to
 * this target's chain (App.tsx's own selection-validity effect already clears selectedFxId in
 * that case; this just has nothing to resolve until the next render does). */
function selectedFx(deps: SequencerRegistryDeps): FxLocator {
  return (project) => {
    const selectedId = deps.getSelectedFxId?.();
    if (!selectedId) return undefined;
    return currentFxChain(deps, project).find((f) => f.id === selectedId);
  };
}

/** fx.count: how many FX exist in the currently selected target's chain, so a caller can bound
 * its own fx.<n> iteration -- same role tracks.count/patterns.count already play. 0 while
 * `getTarget` is unset or the target doesn't exist. */
function createFxCountControl(deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = { id: FX_COUNT_ID, label: "FX count", kind: "number", min: 0, max: 64, default: 0 };
  const count = (project: Project) => currentFxChain(deps, project).length;
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

/** fx.<n>.enabled / fx.selected.enabled: the FX's `On` control (ECS-149) -- `locate` picks which
 * FX this particular id means. Writable: setValue dispatches SET_FX_ENABLED against whichever FX
 * `locate` currently resolves to, mirroring createPatternQueuedControl's "a pad is both feedback
 * and input" shape. */
function createFxEnabledControl(id: string, label: string, locate: FxLocator, deps: SequencerRegistryDeps): ProjectControl<BooleanControlDef> {
  const def: BooleanControlDef = { id, label, kind: "boolean", default: false };
  const isEnabled = (project: Project) => locate(project)?.enabled ?? false;
  const listeners = new Set<(value: boolean, previous: boolean) => void>();
  let last = isEnabled(deps.getProject());

  return {
    def,
    getValue: () => isEnabled(deps.getProject()),
    setValue(value) {
      const instance = locate(deps.getProject());
      const target = deps.getTarget?.();
      if (instance && target) deps.dispatch({ type: "SET_FX_ENABLED", target, fxId: instance.id, enabled: value });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = isEnabled(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

/**
 * fx.<n>.selected: whether `project`'s currently selected target's chain[index] is the FX
 * selected for editing (App.tsx's selectedFxId) -- the direct, pad-grid-style counterpart to
 * `fx.next`/`fx.previous` below. Writable the same way pattern.<n>.selected already is:
 * setValue(true) selects it, setValue(false) is a no-op (no "deselect" affordance anywhere in
 * the UI either).
 */
function createFxSelectedControl(id: string, index: number, deps: SequencerRegistryDeps): ProjectControl<BooleanControlDef> {
  const def: BooleanControlDef = { id, label: `FX ${index + 1} selected`, kind: "boolean", default: false };
  const locate = fxByIndex(index, deps);
  const isSelected = (project: Project) => {
    const instance = locate(project);
    return instance !== undefined && instance.id === deps.getSelectedFxId?.();
  };
  const listeners = new Set<(value: boolean, previous: boolean) => void>();
  let last = isSelected(deps.getProject());

  return {
    def,
    getValue: () => isSelected(deps.getProject()),
    setValue(value) {
      if (!value) return;
      const instance = locate(deps.getProject());
      if (instance) deps.selectFx?.(instance.id);
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

/** fx.selected.index: the 0-based position of the selected FX within the current target's
 * chain, or -1 while nothing is selected -- lets a device identify the current selection without
 * probing every fx.<n>.selected itself, the same role bank.active plays for the selected bank.
 * Feedback-only: selection is always made through fx.<n>.selected/fx.next/fx.previous, which is
 * the application's own "select by id, not by position" boundary -- see selectedFx's doc comment. */
function createFxSelectedIndexControl(deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = { id: FX_SELECTED_INDEX_ID, label: "Selected FX index", kind: "number", min: -1, max: 1024, default: -1 };
  const index = (project: Project) => {
    const selectedId = deps.getSelectedFxId?.();
    if (!selectedId) return -1;
    return currentFxChain(deps, project).findIndex((f) => f.id === selectedId);
  };
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = index(deps.getProject());

  return {
    def,
    getValue: () => index(deps.getProject()),
    setValue: () => {},
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = index(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
  };
}

/** fx.<n>.name / fx.selected.name: the FX type's display label (ECS-149) -- e.g. "Filter",
 * "Delay". Doubles as the stable, human-distinguishing identifier the ticket also asks for:
 * model/fx.ts's own engine constraint (at most one FX of each type per chain, see its module doc
 * comment) means a chain's FX are already distinguishable by type/label alone, so no separate id
 * control is needed. Read-only, the first real StringControlDef consumer outside pattern.<n>.name. */
function createFxNameControl(id: string, label: string, locate: FxLocator, deps: SequencerRegistryDeps): ProjectControl<StringControlDef> {
  const def: StringControlDef = { id, label, kind: "string", default: "" };
  const name = (project: Project) => {
    const instance = locate(project);
    return instance ? FX_DEFS[instance.type].label : "";
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

/** fx.<n>.params.count / fx.selected.params.count: how many parameters that FX's type defines
 * (FX_DEFS[type].params.length), so a caller can bound its own per-FX parameter paging -- same
 * role tracks.count/patterns.count already play for their own domains. 0 while `locate` resolves
 * to nothing. */
function createFxParamsCountControl(id: string, label: string, locate: FxLocator, deps: SequencerRegistryDeps): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = { id, label, kind: "number", min: 0, max: 64, default: 0 };
  const count = (project: Project) => {
    const instance = locate(project);
    return instance ? FX_DEFS[instance.type].params.length : 0;
  };
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

/** A fx.<n>.param.<p>/fx.selected.param.<p> control, tagged with the id of the FxInstance its
 * (type-specific) min/max/step/unit/default were built from -- `resolve()`'s own staleness check
 * below uses this to tell whether the FX occupying that position/selection has since changed to
 * a different one (added/removed/reselected), since unlike every other control in this file, an
 * FX param's *definition* -- not just its value -- depends on which FX is actually there. */
type FxParamControl = ProjectControl<NumericControlDef> & { readonly boundFxId: FxId };

/**
 * fx.<n>.param.<p> / fx.selected.param.<p>: the value of parameter `p` (its position within
 * FX_DEFS[instance.type].params -- a fixed, never-reordered array, so a position is always a
 * stable reference to the same parameter for a given FX type) of whichever FX `locate` resolves
 * to. Range/step/unit/label are read straight from that FxParamDef (ECS-149 requirement: "do not
 * assume every parameter is a conventional linear 0-127 control") -- including the filter's
 * "mode" param, which is already modeled as a stepped 0..1 number (model/fx.ts mirrors webdsp's
 * FilterMode), not a separate enum. midi-core's EnumControlDef needs string option values and
 * these are numeric to match the engine, so mode stays a NumericControlDef like every other
 * param; a connected display can still show its own def.label ("Mode"), just not a per-value
 * name like "Low Pass" -- a real but narrow gap, noted in this change's own summary rather than
 * worked around here with a second, parallel control kind.
 */
function createFxParamControl(
  id: string,
  instance: FxInstance,
  paramIndex: number,
  locate: FxLocator,
  deps: SequencerRegistryDeps,
): FxParamControl | undefined {
  const paramDef = FX_DEFS[instance.type].params[paramIndex];
  if (!paramDef) return undefined;
  const def: NumericControlDef = {
    id,
    label: paramDef.label,
    kind: "number",
    min: paramDef.min,
    max: paramDef.max,
    step: paramDef.step,
    unit: paramDef.unit,
    default: paramDef.default,
  };
  const read = (project: Project) => {
    const current = locate(project);
    return current ? current.params[paramDef.id] ?? paramDef.default : paramDef.default;
  };
  const listeners = new Set<(value: number, previous: number) => void>();
  let last = read(deps.getProject());

  return {
    def,
    boundFxId: instance.id,
    getValue: () => read(deps.getProject()),
    setValue(value) {
      const current = locate(deps.getProject());
      const target = deps.getTarget?.();
      if (current && target) deps.dispatch({ type: "SET_FX_PARAM", target, fxId: current.id, paramId: paramDef.id, value });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject(project) {
      const next = read(project);
      if (next === last) return;
      const previous = last;
      last = next;
      for (const listener of listeners) listener(next, previous);
    },
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
  if (id === FX_NEXT_ID || id === FX_PREVIOUS_ID) {
    // Steps through the current target's chain in order and stops at the ends (same "clamp, don't
    // wrap" choice createBankActions makes for banks), over every FX present regardless of its own
    // enabled/bypassed state -- FxChainStrip.tsx lets a bypassed FX's chip be selected exactly like
    // an enabled one (only its CSS class differs), so "available for navigation" here means
    // "present in the chain", not "enabled" (ECS-149's own navigation-vs-enabled distinction).
    // Starting with nothing selected goes to the first FX for `next`, the last for `previous` --
    // rather than a no-op -- so a lone Next/Previous pair works from a cold start.
    return createAction({ id, label: id === FX_NEXT_ID ? "Next FX" : "Previous FX" }, () => {
      const chain = currentFxChain(deps, deps.getProject());
      if (chain.length === 0) return;
      const selectedId = deps.getSelectedFxId?.();
      const currentIndex = selectedId ? chain.findIndex((f) => f.id === selectedId) : -1;
      const delta = id === FX_NEXT_ID ? 1 : -1;
      const nextIndex = currentIndex === -1 ? (delta > 0 ? 0 : chain.length - 1) : Math.min(chain.length - 1, Math.max(0, currentIndex + delta));
      deps.selectFx?.(chain[nextIndex]!.id);
    });
  }
  return undefined;
}

/** A registry that resolves the sequencer's contract ids against the live project. */
export function createSequencerRegistry(deps: SequencerRegistryDeps): SequencerRegistry {
  const cache = new Map<string, ProjectControl<ControlDef>>();

  // An id that resolves to nothing (e.g. a step/duration id past the current pattern's length,
  // asked for by midi-core's duration-continuation scan reaching back toward a cell with no
  // covering note -- see bindStepFeedback()'s `lookback()`, bounded by this control's own
  // declared `max` of up to 1024) used to redo the *entire* branch chain below from scratch on
  // every single ask, forever: `cache` only ever remembered a *successful* resolution, never a
  // "this id exists, there's just nothing there" one, so none of those negative asks got any
  // cheaper the second time (ECS-152). That scan asks for up to ~1023 positions per visible pad
  // every time the playhead advances, nearly all of them negative, which measured at 75-90ms of
  // main-thread time per advance -- enough to visibly stall the on-screen playhead too, since
  // it shares the same thread. Caching the negative result here (invalidated by clearing the
  // whole set whenever `project` is a new reference, the same "an edit replaces the whole
  // object" assumption the reducer already guarantees) turns the second and later ask for the
  // same negative id back into a single Set lookup.
  let negativeCache = new Set<string>();
  let negativeCacheProject: Project | undefined;

  function resolve(id: string): Control<ControlDef> | undefined {
    const project = deps.getProject();
    if (project !== negativeCacheProject) {
      negativeCache = new Set();
      negativeCacheProject = project;
    }

    const cached = cache.get(id);
    // A fx.*.param control's def (min/max/step/unit) is specific to the FX it was built from --
    // unlike every other cached control in this file, so a cache hit here isn't automatically
    // still correct: the FX at that position/selection may since have changed (added, removed, or
    // reselected). Evict and fall through to recreate it fresh against whatever is there now,
    // rather than silently reading/writing a stale param id against the wrong FX.
    if (cached && (FX_PARAM_ID.test(id) || FX_SELECTED_PARAM_ID.test(id))) {
      const indexed = FX_PARAM_ID.exec(id);
      const live = indexed ? fxByIndex(Number(indexed[1]), deps)(deps.getProject()) : selectedFx(deps)(deps.getProject());
      if (live?.id !== (cached as FxParamControl).boundFxId) cache.delete(id);
      else return cached;
    } else if (cached) {
      return cached;
    } else if (negativeCache.has(id)) {
      return undefined;
    }

    let created: ProjectControl<ControlDef> | undefined;
    const step = STEP_ID.exec(id);
    const stepDuration = STEP_DURATION_ID.exec(id);
    const stepCovered = STEP_COVERED_ID.exec(id);
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
    } else if (stepCovered) {
      const track = project.tracks[Number(stepCovered[1])];
      const column = Number(stepCovered[2]);
      if (track && column < totalBeats(selectedPattern(project, deps.getPatternId()), project.beatsPerBar)) {
        created = createStepCoveredControl(id, track, column, deps) as ProjectControl<ControlDef>;
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
    } else if (id === SELECTION_INDEX_ID) {
      created = createSelectionIndexControl(deps) as ProjectControl<ControlDef>;
    } else if (id === PLAYHEAD_ID) {
      created = createPlayheadControl(deps) as ProjectControl<ControlDef>;
    } else if (id === IS_PLAYING_ID) {
      created = createIsPlayingControl(deps) as ProjectControl<ControlDef>;
    } else if (id === PATTERNS_COUNT_ID) {
      created = createPatternsCountControl(deps) as ProjectControl<ControlDef>;
    } else if (id === QUEUE_LENGTH_ID) {
      created = createQueueLengthControl(deps) as ProjectControl<ControlDef>;
    } else if (id === FX_COUNT_ID) {
      created = createFxCountControl(deps) as ProjectControl<ControlDef>;
    } else if (id === FX_SELECTED_INDEX_ID) {
      created = createFxSelectedIndexControl(deps) as ProjectControl<ControlDef>;
    } else if (id === FX_SELECTED_ENABLED_ID) {
      created = createFxEnabledControl(id, "Selected FX enabled", selectedFx(deps), deps) as ProjectControl<ControlDef>;
    } else if (id === FX_SELECTED_NAME_ID) {
      created = createFxNameControl(id, "Selected FX name", selectedFx(deps), deps) as ProjectControl<ControlDef>;
    } else if (id === FX_SELECTED_PARAMS_COUNT_ID) {
      created = createFxParamsCountControl(id, "Selected FX param count", selectedFx(deps), deps) as ProjectControl<ControlDef>;
    } else {
      const fader = FADER_VOLUME_ID.exec(id);
      const patternPlaying = PATTERN_PLAYING_ID.exec(id);
      const patternQueued = PATTERN_QUEUED_ID.exec(id);
      const patternSelected = PATTERN_SELECTED_ID.exec(id);
      const patternName = PATTERN_NAME_ID.exec(id);
      const patternBars = PATTERN_BARS_ID.exec(id);
      const queueSlotPattern = QUEUE_SLOT_PATTERN_ID.exec(id);
      const queueSlotPlaying = QUEUE_SLOT_PLAYING_ID.exec(id);
      const fxEnabled = FX_ENABLED_ID.exec(id);
      const fxSelected = FX_SELECTED_ID.exec(id);
      const fxName = FX_NAME_ID.exec(id);
      const fxParamsCount = FX_PARAMS_COUNT_ID.exec(id);
      const fxParam = FX_PARAM_ID.exec(id);
      const fxSelectedParam = FX_SELECTED_PARAM_ID.exec(id);
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
      } else if (fxEnabled && currentFxChain(deps, project)[Number(fxEnabled[1])]) {
        const index = Number(fxEnabled[1]);
        created = createFxEnabledControl(id, `FX ${index + 1} enabled`, fxByIndex(index, deps), deps) as ProjectControl<ControlDef>;
      } else if (fxSelected && currentFxChain(deps, project)[Number(fxSelected[1])]) {
        created = createFxSelectedControl(id, Number(fxSelected[1]), deps) as ProjectControl<ControlDef>;
      } else if (fxName && currentFxChain(deps, project)[Number(fxName[1])]) {
        const index = Number(fxName[1]);
        created = createFxNameControl(id, `FX ${index + 1} name`, fxByIndex(index, deps), deps) as ProjectControl<ControlDef>;
      } else if (fxParamsCount && currentFxChain(deps, project)[Number(fxParamsCount[1])]) {
        const index = Number(fxParamsCount[1]);
        created = createFxParamsCountControl(id, `FX ${index + 1} param count`, fxByIndex(index, deps), deps) as ProjectControl<ControlDef>;
      } else if (fxParam) {
        const index = Number(fxParam[1]);
        const instance = currentFxChain(deps, project)[index];
        if (instance) created = createFxParamControl(id, instance, Number(fxParam[2]), fxByIndex(index, deps), deps) as ProjectControl<ControlDef> | undefined;
      } else if (fxSelectedParam) {
        const instance = selectedFx(deps)(project);
        if (instance) created = createFxParamControl(id, instance, Number(fxSelectedParam[1]), selectedFx(deps), deps) as ProjectControl<ControlDef> | undefined;
      }
    }

    if (created) cache.set(id, created);
    else negativeCache.add(id);
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
      (resolve(IS_PLAYING_ID) as ProjectControl<ControlDef> | undefined)?.syncFromProject(deps.getProject());
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
