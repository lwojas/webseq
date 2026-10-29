// Mirrors a project FX chain (an ordered FxInstance[] on a track or on master) onto the engine's
// per-bus FX chain (webdsp docs/fx-chain.md): one engine effect instance per FxInstance, in the
// same order, any number of the same kind. This replaces the old fixed six-slot approach that
// pushed values into one legacy node per type — that capped a chain at one FX per type and
// ignored array order. The only file besides model/fx.ts that knows what each FxType's
// parameters mean in engine terms (the NodeParam ids below).
//
// Identity: an FxInstance's string id is the key; the engine's numeric EffectId is runtime-only
// state kept here (like BusId in buses.ts), never persisted. Sync is incremental and idempotent:
// removed instances are removed, new ones added at their index, order fixed with moveEffect, and
// a parameter is only written when it changed, so calling sync on every project edit is cheap.
//
// Bypass uses the engine's own setEffectEnabled (a bit-exact skip that also clears the
// effect's tail), so no per-kind "transparent value" approximations are needed any more.
//
// Automation (audio/automation.ts) is scheduled on the audio clock rather than written here: it asks
// target() for the engine effect and parameter, and markWritten() records that it moved a parameter.
// The two keep separate bookkeeping: `base` is the last project value sync pushed (so sync only reacts
// to a *user edit*), `written` is whatever automation last told the engine (so restoreBase() knows
// what to put back when playback halts). setParam() remains for direct writes.
import { EffectKind, NodeParam, type AudioRuntime, type BusId, type EffectId } from "webdsp";
import { FX_DEFS } from "../model/fx";
import type { FxId, FxInstance, FxType, TrackLfo } from "../model/types";
import { syncLfoSlots } from "./lfoSync";

export const FX_KIND: Record<FxType, EffectKind> = {
  filter: EffectKind.Filter,
  chorusFlanger: EffectKind.ChorusFlanger,
  delay: EffectKind.Delay,
  reverb: EffectKind.Reverb,
  compressor: EffectKind.Compressor,
  saturation: EffectKind.Saturation,
  phaser: EffectKind.Phaser,
  bitcrusher: EffectKind.Bitcrusher,
  utility: EffectKind.Utility,
  dubDelay: EffectKind.DubDelay,
  eq: EffectKind.Eq,
  glitch: EffectKind.Glitch,
};

/** FX param id (model/fx.ts FX_DEFS) -> the engine's NodeParam. */
// EQ params are `b<n><Field>` -> NodeParam.EqBand<n><Field> (n = 1..4).
const EQ_FIELDS = ["On", "Type", "Freq", "Gain", "Q", "ShelfSlope", "Slope"] as const;
const EQ_NODE_PARAMS: Record<string, NodeParam> = Object.fromEntries(
  [1, 2, 3, 4].flatMap((n) => EQ_FIELDS.map((f) => [`b${n}${f}`, NodeParam[`EqBand${n}${f}` as keyof typeof NodeParam]])),
);

export const FX_NODE_PARAMS: Record<FxType, Record<string, NodeParam>> = {
  filter: {
    mode: NodeParam.FilterMode,
    cutoff: NodeParam.FilterCutoff,
    resonance: NodeParam.FilterResonance,
    slope: NodeParam.FilterSlope,
  },
  chorusFlanger: {
    rate: NodeParam.ChorusFlangerRate,
    depth: NodeParam.ChorusFlangerDepth,
    delay: NodeParam.ChorusFlangerDelay,
    feedback: NodeParam.ChorusFlangerFeedback,
    stereoPhase: NodeParam.ChorusFlangerStereoPhase,
    mix: NodeParam.ChorusFlangerMix,
  },
  delay: { time: NodeParam.DelayTime, feedback: NodeParam.DelayFeedback, mix: NodeParam.DelayMix },
  reverb: { decay: NodeParam.ReverbDecay, damping: NodeParam.ReverbDamping, mix: NodeParam.ReverbMix },
  compressor: {
    threshold: NodeParam.CompThreshold,
    ratio: NodeParam.CompRatio,
    attack: NodeParam.CompAttack,
    release: NodeParam.CompRelease,
    knee: NodeParam.CompKnee,
    makeup: NodeParam.CompMakeup,
  },
  saturation: {
    drive: NodeParam.SatDrive,
    asymmetry: NodeParam.SatAsymmetry,
    outputGain: NodeParam.SatOutputGain,
    mix: NodeParam.SatMix,
  },
  phaser: {
    rate: NodeParam.PhaserRate,
    depth: NodeParam.PhaserDepth,
    center: NodeParam.PhaserCenter,
    feedback: NodeParam.PhaserFeedback,
    stages: NodeParam.PhaserStages,
    mix: NodeParam.PhaserMix,
  },
  bitcrusher: { bits: NodeParam.CrushBits, downsample: NodeParam.CrushDownsample, mix: NodeParam.CrushMix },
  utility: { gain: NodeParam.UtilityGain },
  dubDelay: {
    division: NodeParam.DubDelayDivision,
    feedback: NodeParam.DubDelayFeedback,
    tone: NodeParam.DubDelayTone,
    mix: NodeParam.DubDelayMix,
  },
  eq: EQ_NODE_PARAMS,
  glitch: {
    mix: NodeParam.GlitchMix,
    mode: NodeParam.GlitchMode,
    division: NodeParam.GlitchDivision,
    speed: NodeParam.GlitchSpeed,
  },
};

interface LiveEffect {
  engineId: EffectId;
  type: FxType;
  enabled: boolean;
  /** Last project value pushed by sync(). */
  base: Map<string, number>;
  /** Value currently in the engine (sync or automation). */
  written: Map<string, number>;
  /** Last LFO config pushed per slot ("" = empty), so unchanged slots are never resent. */
  lfoSent: string[];
}

interface BusChain {
  effects: Map<FxId, LiveEffect>;
  /** Project FxIds in the engine's current processing order. */
  order: FxId[];
}

export class FxChainSync {
  private chains = new Map<BusId, BusChain>();

  constructor(private readonly runtime: AudioRuntime) {}

  /** The engine's id for a project FX on `busId`, or undefined before sync has created it. */
  engineIdOf(busId: BusId, fxId: FxId): EffectId | undefined {
    return this.chains.get(busId)?.effects.get(fxId)?.engineId;
  }

  /** Brings the engine chain on `busId` in line with `fx`. */
  sync(busId: BusId, fx: FxInstance[]): void {
    let chain = this.chains.get(busId);
    if (!chain) {
      // Nothing to do for an empty chain on a bus we have never touched — keeps unused buses
      // dormant in the engine (see busSync.ts).
      if (fx.length === 0) return;
      chain = { effects: new Map(), order: [] };
      this.chains.set(busId, chain);
    }
    const wanted = new Set(fx.map((f) => f.id));

    for (const [id, live] of chain.effects) {
      if (wanted.has(id)) continue;
      this.runtime.removeEffect(busId, live.engineId);
      chain.effects.delete(id);
      chain.order = chain.order.filter((o) => o !== id);
    }

    fx.forEach((instance, index) => {
      let live = chain!.effects.get(instance.id);
      if (!live) {
        let engineId: EffectId;
        try {
          engineId = this.runtime.addEffect(busId, FX_KIND[instance.type], { index, enabled: instance.enabled });
        } catch {
          return; // chain full — the model caps at the same limit, so this is a pasted/loaded overflow
        }
        live = { engineId, type: instance.type, enabled: instance.enabled, base: new Map(), written: new Map(), lfoSent: [] };
        chain!.effects.set(instance.id, live);
        chain!.order.splice(index, 0, instance.id);
      } else if (chain!.order[index] !== instance.id) {
        this.runtime.moveEffect(busId, live.engineId, index);
        chain!.order = chain!.order.filter((o) => o !== instance.id);
        chain!.order.splice(index, 0, instance.id);
      }
      if (live.enabled !== instance.enabled) {
        this.runtime.setEffectEnabled(busId, live.engineId, instance.enabled);
        live.enabled = instance.enabled;
      }
      for (const def of FX_DEFS[instance.type].params) {
        const param = FX_NODE_PARAMS[instance.type][def.id];
        if (param === undefined) continue;
        const value = instance.params[def.id] ?? def.default;
        if (live.base.get(def.id) === value) continue;
        live.base.set(def.id, value);
        live.written.set(def.id, value);
        this.runtime.setEffectParameter(busId, live.engineId, param, value);
      }
      this.syncLfos(busId, live, instance.lfos ?? []);
    });
  }

  /** Pushes the instance's LFO stack (model TrackLfo -> webdsp setEffectLfo); see lfoSync.ts. The
   * engine adds the LFOs on top of the parameter's base value, which stays whatever sync() or
   * automation last wrote. */
  private syncLfos(busId: BusId, live: LiveEffect, lfos: readonly TrackLfo[]): void {
    const info = this.runtime.getModulationInfo?.();
    if (!info) return;
    const targets = new Map<string, number>();
    for (const p of this.runtime.getEffectModulationTargets?.(FX_KIND[live.type]) ?? []) targets.set(p.name, p.id);
    syncLfoSlots(
      info,
      lfos,
      targets,
      live.lfoSent,
      (slot, lfo) => this.runtime.setEffectLfo(busId, live.engineId, slot, lfo),
      (slot) => this.runtime.clearEffectLfo(busId, live.engineId, slot),
    );
  }

  /** Writes one (automated) parameter value straight to the engine instance for `fxId`. A
   * no-op if that instance isn't live on `busId` yet or the value is already in the engine. */
  setParam(busId: BusId, fxId: FxId, paramId: string, value: number): void {
    const live = this.chains.get(busId)?.effects.get(fxId);
    if (!live) return;
    const param = FX_NODE_PARAMS[live.type][paramId];
    if (param === undefined || live.written.get(paramId) === value) return;
    live.written.set(paramId, value);
    this.runtime.setEffectParameter(busId, live.engineId, param, value);
  }

  /** The engine target of one parameter of one live FX instance, for scheduled parameter events
   * (audio/automation.ts), or undefined if the instance or parameter is not live. */
  target(busId: BusId, fxId: FxId, paramId: string): { effect: { bus: BusId; effect: EffectId }; param: NodeParam } | undefined {
    const live = this.chains.get(busId)?.effects.get(fxId);
    const param = live ? FX_NODE_PARAMS[live.type][paramId] : undefined;
    return live && param !== undefined ? { effect: { bus: busId, effect: live.engineId }, param } : undefined;
  }

  /** Records that automation has been told to move `paramId` to `value` (scheduled, not written
   * directly), so restoreBase() knows to put the project value back when playback halts. */
  markWritten(busId: BusId, fxId: FxId, paramId: string, value: number): void {
    this.chains.get(busId)?.effects.get(fxId)?.written.set(paramId, value);
  }

  /** Puts every parameter that automation moved away from its project value back to that value.
   * Called when playback halts, so a stopped transport doesn't leave an effect parked at the
   * last automated value. */
  restoreBase(): void {
    for (const [busId, chain] of this.chains) {
      for (const live of chain.effects.values()) {
        for (const [paramId, base] of live.base) {
          if (live.written.get(paramId) === base) continue;
          const param = FX_NODE_PARAMS[live.type][paramId];
          if (param === undefined) continue;
          live.written.set(paramId, base);
          this.runtime.setEffectParameter(busId, live.engineId, param, base);
        }
      }
    }
  }

  /** Forgets every live instance's cached values so the next sync() rewrites them — for when
   * the engine side was reset underneath us. */
  invalidate(): void {
    for (const chain of this.chains.values()) {
      for (const live of chain.effects.values()) {
        live.base.clear();
        live.written.clear();
        live.lfoSent = [];
      }
    }
  }
}

const syncs = new WeakMap<AudioRuntime, FxChainSync>();

/** The one FxChainSync for `runtime`. Engine effect ids are only meaningful to the runtime that
 * issued them, so the mapping lives exactly as long as it does (same lifetime rule as the
 * track bus map in buses.ts). */
export function fxChainsFor(runtime: AudioRuntime): FxChainSync {
  let sync = syncs.get(runtime);
  if (!sync) {
    sync = new FxChainSync(runtime);
    syncs.set(runtime, sync);
  }
  return sync;
}
