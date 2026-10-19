// Applies automation lanes to the engine: the playback half of model/automation.ts. A lane is
// one modulation source of one parameter; here its value at the playhead is written as that
// parameter's BASE value, and webdsp's LFO bank (which owns the parameter's modulation stack)
// adds any LFOs on top. The three owners a lane can address share this one path:
//
//   FX parameter       -> FxChainSync.setParam       -> setEffectParameter
//   synth control      -> InstrumentHost.setParam    -> setInstrumentParameter
//   sample envelope    -> setSampleParameter (below; per asset)
//   sample pitch       -> read per note at schedule time (compile.ts), not here
//
// Polled by Transport at its ~25 ms tick, against the beat within the sounding chain step. Each
// writer dedupes against what the engine already has, so an unchanged lane costs nothing.
import { SampleParam, type AudioRuntime, type BusId } from "webdsp";
import { valueAtBeat } from "../model/automation";
import type { AutomationLane, FxInstance, FxTarget, Project, Track } from "../model/types";
import { DEFAULT_ENVELOPE } from "../model/types";
import { fxChainsFor } from "./fxChain";
import { instrumentHostFor } from "./instruments";

const ENVELOPE_PARAMS: Record<string, SampleParam> = {
  attack: SampleParam.EnvAttack,
  decay: SampleParam.EnvDecay,
  sustain: SampleParam.EnvSustain,
  release: SampleParam.EnvRelease,
};

// Per runtime: the last automated value written for each sample-envelope parameter, and which
// assets automation has touched (so stopping can put their model envelope back).
interface SampleAutomationState {
  written: Map<string, number>;
  touched: Set<number>;
}
const sampleStates = new WeakMap<AudioRuntime, SampleAutomationState>();

function sampleState(runtime: AudioRuntime): SampleAutomationState {
  let s = sampleStates.get(runtime);
  if (!s) {
    s = { written: new Map(), touched: new Set() };
    sampleStates.set(runtime, s);
  }
  return s;
}

function applyOwner(
  runtime: AudioRuntime,
  owner: { fx: FxInstance[]; automation: AutomationLane[] },
  track: Track | null,
  busId: BusId | undefined,
  beat: number,
): void {
  const chains = fxChainsFor(runtime);
  for (const lane of owner.automation) {
    const value = valueAtBeat(lane, beat);
    if (value === null) continue;
    if (lane.fxId != null) {
      const instance = owner.fx.find((f) => f.id === lane.fxId);
      if (!instance || !instance.enabled || busId === undefined) continue;
      chains.setParam(busId, lane.fxId, lane.parameter, value);
    } else if (track?.instrument) {
      instrumentHostFor(runtime).setParam(track.id, lane.parameter, value);
    } else if (track?.assetId != null && lane.parameter in ENVELOPE_PARAMS) {
      const state = sampleState(runtime);
      const key = `${track.assetId}:${lane.parameter}`;
      if (state.written.get(key) === value) continue;
      state.written.set(key, value);
      state.touched.add(track.assetId);
      runtime.setSampleParameter(track.assetId, ENVELOPE_PARAMS[lane.parameter], value);
    }
  }
}

/** Writes every lane's value at `beat` (the master's and each track's). */
export function applyAutomation(
  runtime: AudioRuntime,
  project: Project,
  getBusId: (target: FxTarget) => BusId | undefined,
  beat: number,
): void {
  applyOwner(runtime, project.master, null, getBusId("master"), beat);
  for (const track of project.tracks) applyOwner(runtime, track, track, getBusId(track.id), beat);
}

/** Puts every automated parameter back to its project value. Called when playback halts, so a
 * stopped transport doesn't leave anything parked at the last automated value. */
export function restoreAutomation(runtime: AudioRuntime, project: Project): void {
  fxChainsFor(runtime).restoreBase();
  instrumentHostFor(runtime).restoreBase();
  const state = sampleState(runtime);
  for (const assetId of state.touched) {
    const asset = project.assets.find((a) => a.id === assetId);
    if (asset) runtime.setSampleEnvelope(asset.id, asset.envelope ?? DEFAULT_ENVELOPE);
  }
  state.touched.clear();
  state.written.clear();
}
