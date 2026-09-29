// Pushes a track's (or master's) FX chain to webdsp as real-time bus parameters. The only
// file besides src/model/fx.ts that knows what a "filter", "delay", or "reverb" *is* — this
// is the generic AudioModule-style abstraction's counterpart on the engine side, translating
// FxInstance.params into NodeParam calls on whichever BusId that target owns (see
// src/audio/buses.ts). Called both on live parameter edits and, at the same tick rate as note
// scheduling, by Transport's automation polling (see transport.ts) — never from a React
// render, only from an explicit "the user changed this" or "the playhead advanced" event.
//
// One approximation, inherited from the original single-module prototype: webdsp's filter has
// no dedicated bypass control (once parameterized it stays shaped until reparameterized), so
// "no filter in this chain" / "filter disabled" is approximated by pushing the cutoff to
// whichever edge of the audible range is transparent for the current mode. Delay and reverb
// both have a real bypass (mix = 0), used both when disabled and when absent.
import { FilterMode, NodeParam, type AudioRuntime, type BusId } from "webdsp";
import type { FxInstance } from "../model/types";

const MIN_CUTOFF_HZ = 40;
const MAX_CUTOFF_HZ = 18000;

function transparentCutoffFor(mode: number): number {
  return mode === FilterMode.HighPass ? MIN_CUTOFF_HZ : MAX_CUTOFF_HZ;
}

function applyFilter(runtime: AudioRuntime, busId: BusId, instance: FxInstance | undefined): void {
  const mode = instance?.params.mode ?? FilterMode.LowPass;
  const enabled = instance?.enabled ?? false;
  const cutoff = enabled ? (instance?.params.cutoff ?? MAX_CUTOFF_HZ) : transparentCutoffFor(mode);
  const resonance = instance?.params.resonance ?? 0.707;
  runtime.setNodeParameter(busId, NodeParam.FilterMode, mode);
  runtime.setNodeParameter(busId, NodeParam.FilterCutoff, cutoff);
  runtime.setNodeParameter(busId, NodeParam.FilterResonance, resonance);
}

function applyDelay(runtime: AudioRuntime, busId: BusId, instance: FxInstance | undefined): void {
  const enabled = instance?.enabled ?? false;
  const mix = enabled ? (instance?.params.mix ?? 0) : 0;
  runtime.setNodeParameter(busId, NodeParam.DelayTime, instance?.params.time ?? 0.25);
  runtime.setNodeParameter(busId, NodeParam.DelayFeedback, instance?.params.feedback ?? 0.3);
  runtime.setNodeParameter(busId, NodeParam.DelayMix, mix);
}

function applyReverb(runtime: AudioRuntime, busId: BusId, instance: FxInstance | undefined): void {
  const enabled = instance?.enabled ?? false;
  const mix = enabled ? (instance?.params.mix ?? 0) : 0;
  runtime.setNodeParameter(busId, NodeParam.ReverbDecay, instance?.params.decay ?? 0.5);
  runtime.setNodeParameter(busId, NodeParam.ReverbDamping, instance?.params.damping ?? 0.2);
  runtime.setNodeParameter(busId, NodeParam.ReverbMix, mix);
}

/** Pushes the full state of one FX chain onto its bus, including resetting any FX type that
 * chain no longer contains back to transparent — so removing an FX audibly reverts to
 * pass-through rather than leaving the bus stuck at that FX's last parameters. Note: webdsp's
 * Bus chain applies filter, then delay, then reverb unconditionally (a fixed three-node
 * native chain, see webdsp's ARCHITECTURE.md "Buses / mixing" and "How DSP is composed")
 * regardless of this array's order — see FX_DEFS's doc comment in model/fx.ts. */
export function applyFxChain(runtime: AudioRuntime, busId: BusId, fx: FxInstance[]): void {
  applyFilter(runtime, busId, fx.find((f) => f.type === "filter"));
  applyDelay(runtime, busId, fx.find((f) => f.type === "delay"));
  applyReverb(runtime, busId, fx.find((f) => f.type === "reverb"));
}

/** Applies one automated parameter value directly (bypassing the FX's base `params`), for
 * Transport's per-tick automation polling — see transport.ts. Only ever called for a
 * parameter with an active automation lane. */
export function applyAutomatedParam(runtime: AudioRuntime, busId: BusId, fxType: FxInstance["type"], paramId: string, value: number): void {
  if (fxType === "filter") {
    if (paramId === "cutoff") runtime.setNodeParameter(busId, NodeParam.FilterCutoff, value);
    else if (paramId === "resonance") runtime.setNodeParameter(busId, NodeParam.FilterResonance, value);
    else if (paramId === "mode") runtime.setNodeParameter(busId, NodeParam.FilterMode, value);
  } else if (fxType === "delay") {
    if (paramId === "time") runtime.setNodeParameter(busId, NodeParam.DelayTime, value);
    else if (paramId === "feedback") runtime.setNodeParameter(busId, NodeParam.DelayFeedback, value);
    else if (paramId === "mix") runtime.setNodeParameter(busId, NodeParam.DelayMix, value);
  } else if (fxType === "reverb") {
    if (paramId === "decay") runtime.setNodeParameter(busId, NodeParam.ReverbDecay, value);
    else if (paramId === "damping") runtime.setNodeParameter(busId, NodeParam.ReverbDamping, value);
    else if (paramId === "mix") runtime.setNodeParameter(busId, NodeParam.ReverbMix, value);
  }
}
