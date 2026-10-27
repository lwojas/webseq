// Applies automation lanes to the engine: the playback half of model/automation.ts. A lane is one
// modulation source of one parameter; here it becomes webdsp scheduled parameter events (a step, or
// a linear ramp per segment) on the audio clock, which write the parameter's BASE value. webdsp's
// LFO bank, which owns the parameter's modulation stack, adds any LFOs on top. The owners a lane
// can address share this one path:
//
//   FX parameter       -> { effect: { bus, effect } }  via FxChainSync.target
//   synth control      -> { instrument }               via InstrumentHost.target
//   sample envelope    -> { sample }                   (per asset)
//   sample pitch       -> read per note at schedule time (compile.ts), not here
//
// Scheduling is windowed, like notes but shorter: each transport tick schedules the lane events whose
// time falls in the window up to now + lookahead, against the step windows Transport already
// compiled (lane positions are beats from the start of the sounding chain step, so each step
// iteration replays the lane from its start). Because only the next ~150 ms is ever queued, a lane
// edited while playing takes effect almost at once: the edited lane is also *refreshed* at the
// moment of the change (a step or the active ramp from the current value), which replaces a ramp the
// old data had running. See webdsp docs/scheduled-params.md for the engine semantics (block-granular,
// last writer per parameter wins, a direct write ends a ramp).
//
// A user edit of the parameter's own control (a slider) while a lane drives it wins only until the
// lane's next event.
import { SampleParam, type AudioRuntime, type BusId, type ScheduledParam, type SequenceParamEvent } from "webdsp";
import { valueAtBeat } from "../model/automation";
import type { AutomationLane, FxTarget, Project, Track, TrackId } from "../model/types";
import { DEFAULT_ENVELOPE } from "../model/types";
import { fxChainsFor } from "./fxChain";
import { instrumentHostFor } from "./instruments";

const BEATS_PER_QUARTER = 4; // a webseq beat is a sixteenth

const ENVELOPE_PARAMS: Record<string, SampleParam> = {
  attack: SampleParam.EnvAttack,
  decay: SampleParam.EnvDecay,
  sustain: SampleParam.EnvSustain,
  release: SampleParam.EnvRelease,
};

/** One scheduled write of a lane, relative to the start of the step it plays in. */
export interface LaneEvent {
  /** Beats from the step start. */
  pos: number;
  /** The value reached: at `pos` for a step, at `pos + rampBeats` for a ramp. */
  value: number;
  /** Ramp start value and length (beats); absent for a step. */
  from?: number;
  rampBeats?: number;
}

/** A lane as scheduled events. The lane contract (model/types.ts): hold the first value before the
 * first point, linear between points, hold the last value after it. So: a step to the first value at
 * the step start if the first point is later, one ramp per segment (a step if the two values are
 * equal), and a closing step on the last point. Pure. */
export function laneEvents(lane: AutomationLane): LaneEvent[] {
  const pts = lane.events;
  if (pts.length === 0) return [];
  const out: LaneEvent[] = [];
  if (pts[0].position > 0) out.push({ pos: 0, value: pts[0].value });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.value === b.value) out.push({ pos: a.position, value: a.value });
    else out.push({ pos: a.position, from: a.value, value: b.value, rampBeats: b.position - a.position });
  }
  const last = pts[pts.length - 1];
  out.push({ pos: last.position, value: last.value });
  return out;
}

/** What the lane is doing at `beat`, as one event to apply right then: its value, and, inside a
 * segment, the rest of that ramp. Used to refresh a lane that was just edited, and to start one
 * mid-step. Pure. */
export function laneStateAt(lane: AutomationLane, beat: number): LaneEvent | null {
  const value = valueAtBeat(lane, beat);
  if (value === null) return null;
  const pts = lane.events;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (beat >= a.position && beat < b.position && a.value !== b.value) {
      return { pos: beat, from: value, value: b.value, rampBeats: b.position - beat };
    }
  }
  return { pos: beat, value };
}

interface StepWindowLike {
  startTime: number;
  endTime: number;
}

/** Who owns an automation lane: the master or a track. Their lanes are pattern-local (they replay from the start of
 * each sequence/step they play in). */
export type AutomationOwner = { kind: "master" } | { kind: "track"; id: TrackId };

/** The windows an owner's lanes are replayed over. Pattern mode replays every owner over every step; Song mode, where
 * several sequences play at once, gives each owner the sequences it applies to (model/composer.ts automationAppliesTo). */
export type WindowsFor = (owner: AutomationOwner) => readonly StepWindowLike[];

/** Which owners a native sequence's automation covers (see automationSequenceEvents). */
export interface AutomationScope {
  master: boolean;
  /** Track ids whose lanes are included; null = every track. */
  tracks: ReadonlySet<TrackId> | null;
}

interface LaneRef {
  owner: AutomationOwner;
  key: string;
  lane: AutomationLane;
  /** Resolves the engine target for this lane, or undefined if it is not live (yet). */
  target: () => { targets: { target: ScheduledParam["target"]; param: number }[]; mark: (value: number) => void } | undefined;
}

// Per runtime: the lane objects last seen (to detect an edit), and the asset envelopes automation
// has touched (so stopping can put their model envelope back).
interface AutomationState {
  cursor: number;
  seen: Map<string, AutomationLane>;
  touchedAssets: Set<number>;
}
const states = new WeakMap<AudioRuntime, AutomationState>();

function stateFor(runtime: AudioRuntime): AutomationState {
  let s = states.get(runtime);
  if (!s) {
    s = { cursor: 0, seen: new Map(), touchedAssets: new Set() };
    states.set(runtime, s);
  }
  return s;
}

function lanesOf(
  runtime: AudioRuntime,
  owner: { fx: { id: string; enabled: boolean }[]; automation: AutomationLane[] },
  ownerKey: string,
  ownerRef: AutomationOwner,
  track: Track | null,
  busId: BusId | undefined,
  state: AutomationState,
): LaneRef[] {
  const out: LaneRef[] = [];
  const chains = fxChainsFor(runtime);
  for (const lane of owner.automation) {
    const key = `${ownerKey}::${lane.fxId ?? ""}::${lane.parameter}`;
    if (lane.fxId != null) {
      const fxId = lane.fxId;
      if (busId === undefined) continue;
      out.push({
        owner: ownerRef,
        key,
        lane,
        target: () => {
          const t = chains.target(busId, fxId, lane.parameter);
          return t && { targets: [{ target: { effect: t.effect }, param: t.param }], mark: (v) => chains.markWritten(busId, fxId, lane.parameter, v) };
        },
      });
    } else if (track?.instrument) {
      const host = instrumentHostFor(runtime);
      out.push({
        owner: ownerRef,
        key,
        lane,
        target: () => {
          // A chord track has several instances; the lane moves the control on all of them.
          const t = host.targets(track.id, lane.parameter);
          return t.length > 0 ? { targets: t.map((x) => ({ target: { instrument: x.instrument }, param: x.param })), mark: (v) => host.markWritten(track.id, lane.parameter, v) } : undefined;
        },
      });
    } else if (track?.assetId != null && lane.parameter in ENVELOPE_PARAMS) {
      const assetId = track.assetId;
      out.push({
        owner: ownerRef,
        key,
        lane,
        target: () => ({
          targets: [{ target: { sample: assetId }, param: ENVELOPE_PARAMS[lane.parameter] }],
          mark: () => state.touchedAssets.add(assetId),
        }),
      });
    }
  }
  return out;
}

/** Starts a playback session of automation scheduling: `from` is the engine time of the first
 * audible moment. Every lane is treated as freshly changed, so it is refreshed to its state at the
 * point playback starts from. Call from Transport.play(). */
export function startAutomation(runtime: AudioRuntime, from: number): void {
  const s = stateFor(runtime);
  s.cursor = from;
  s.seen.clear();
}

/** The lanes of the owners in `scope`: the master's and the chosen tracks'. */
function automationRefs(
  runtime: AudioRuntime,
  project: Project,
  getBusId: (target: FxTarget) => BusId | undefined,
  state: AutomationState,
  scope: AutomationScope,
): LaneRef[] {
  const refs: LaneRef[] = [];
  if (scope.master) refs.push(...lanesOf(runtime, project.master, "master", { kind: "master" }, null, getBusId("master"), state));
  for (const track of project.tracks) {
    if (scope.tracks && !scope.tracks.has(track.id)) continue;
    refs.push(...lanesOf(runtime, track, track.id, { kind: "track", id: track.id }, track, getBusId(track.id), state));
  }
  return refs;
}

/** Schedules the lane events of the window [cursor, horizon). `windows` are the step iterations the
 * transport has compiled (start/end engine times); `spb` is seconds per beat. `now` is the engine
 * time, for refreshing lanes edited since the last call. */
export function scheduleAutomation(
  runtime: AudioRuntime,
  project: Project,
  getBusId: (target: FxTarget) => BusId | undefined,
  windows: readonly StepWindowLike[] | WindowsFor,
  spb: number,
  now: number,
  horizon: number,
): void {
  const state = stateFor(runtime);
  const lo = state.cursor;
  if (horizon <= lo) return;
  state.cursor = horizon;

  // A plain window list is Pattern mode: every lane replays over every step. A WindowsFor is Song mode, where each
  // owner has its own windows.
  const windowsFor: WindowsFor = typeof windows === "function" ? windows : () => windows;
  const refs = automationRefs(runtime, project, getBusId, state, { master: true, tracks: null });
  const events: ScheduledParam[] = [];

  for (const ref of refs) {
    const windows = windowsFor(ref.owner);
    if (windows.length === 0) continue;
    const current = windows.find((w) => w.startTime <= now && now < w.endTime);
    const resolved = ref.target();
    if (!resolved) continue;
    const emit = (time: number, e: { value: number; from?: number; ramp?: number }) => {
      for (const t of resolved.targets) {
        events.push({ time, target: t.target, param: t.param, value: e.value, ...(e.from !== undefined ? { from: e.from, ramp: e.ramp } : {}) });
      }
      resolved.mark(e.value);
    };
    const changed = state.seen.get(ref.key) !== ref.lane;
    state.seen.set(ref.key, ref.lane);
    // A refresh stands in for everything up to now, so events at or before it are not repeated.
    const coveredUntil = changed && current ? now : -Infinity;

    // An edited (or just started) lane: bring the engine to what the lane says *now*.
    if (changed && current) {
      const s = laneStateAt(ref.lane, (now - current.startTime) / spb);
      if (s) emit(now, { value: s.value, from: s.from, ramp: s.rampBeats !== undefined ? s.rampBeats * spb : undefined });
    }
    const evs = laneEvents(ref.lane);
    for (const w of windows) {
      const a = Math.max(lo, w.startTime);
      const b = Math.min(horizon, w.endTime);
      if (a >= b) continue;
      for (const e of evs) {
        const t = w.startTime + e.pos * spb;
        if (t < a || t >= b || t <= coveredUntil) continue;
        emit(t, { value: e.value, from: e.from, ramp: e.rampBeats !== undefined ? e.rampBeats * spb : undefined });
      }
    }
  }
  if (events.length > 0) runtime.scheduleParams(events);
}

/** Every lane's events for ONE step iteration of the queue, as native-sequence parameter events (webdsp Sequence): `stepStartBeats`
 * and `stepBeats` are in webseq beats (sixteenths) from the start of the queue's cycle, and the events come out in quarter notes. The
 * same lane contract as scheduleAutomation, so a host playing the sequence automates exactly as this scheduler would. Lanes whose
 * target does not exist in the engine yet are left out (the sequence is sent again when it does). */
export function automationSequenceEvents(
  runtime: AudioRuntime,
  project: Project,
  getBusId: (target: FxTarget) => BusId | undefined,
  stepStartBeats: number,
  stepBeats: number,
  scope: AutomationScope = { master: true, tracks: null },
): SequenceParamEvent[] {
  const state = stateFor(runtime);
  const refs = automationRefs(runtime, project, getBusId, state, scope);
  const out: SequenceParamEvent[] = [];
  for (const ref of refs) {
    const resolved = ref.target();
    if (!resolved) continue;
    for (const e of laneEvents(ref.lane)) {
      if (e.pos >= stepBeats) continue; // beyond the pattern's end: that pattern never plays it
      for (const t of resolved.targets) {
        out.push({
          beat: (stepStartBeats + e.pos) / BEATS_PER_QUARTER,
          kind: "param",
          target: t.target,
          param: t.param,
          value: e.value,
          ...(e.from !== undefined ? { from: e.from, rampBeats: (e.rampBeats ?? 0) / BEATS_PER_QUARTER } : {}),
        });
      }
    }
  }
  return out;
}

/** Puts every automated parameter back to its project value. Called when playback halts (after
 * runtime.cancelScheduled()), so a stopped transport doesn't leave anything parked at the last
 * automated value; the direct writes also end any ramp still running in the engine. */
export function restoreAutomation(runtime: AudioRuntime, project: Project): void {
  fxChainsFor(runtime).restoreBase();
  instrumentHostFor(runtime).restoreBase();
  const state = stateFor(runtime);
  for (const assetId of state.touchedAssets) {
    const asset = project.assets.find((a) => a.id === assetId);
    if (asset) runtime.setSampleEnvelope(asset.id, asset.envelope ?? DEFAULT_ENVELOPE);
  }
  state.touchedAssets.clear();
  state.seen.clear();
}
