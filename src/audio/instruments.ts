// Bridges Track.instrument (a synth source — model/instruments.ts) to webdsp's synthesized-
// instrument API (docs/instruments.md): creates one engine instance per synth track, routes it
// into that track's own bus (so the track's FX chain, volume, pan, mute and solo all apply
// exactly as for a sample), pushes its controls, and plays sequenced/manual notes.
//
// An engine InstrumentId, like a SampleId, is runtime-only; it is kept here and never
// persisted. webdsp bakes an instrument's bus and kind in at createInstrument() time, so a
// kind change (or bus change) recreates the instance. Controls are addressed by the engine's
// advertised control *name* ("pitchDrop"), which is what model/instruments.ts uses as its
// param ids, so there is no second id table to keep in sync.
//
// One instance is one monophonic machine, so a track playing a synth is inherently mono: a new
// note retriggers it. That is the engine's rule, not the track's voiceMode.
import type { AudioRuntime, BusId, InstrumentId, InstrumentKind, InstrumentNoteParams } from "webdsp";
import type { Project, TrackId, TrackLfo } from "../model/types";
import type { TrackBusMap } from "./buses";

interface LiveInstrument {
  kindId: string;
  kind: InstrumentKind;
  /** Last LFO config pushed per slot ("" = slot empty), so unchanged slots are never resent. */
  lfoSent: string[];
  bus: BusId;
  id: InstrumentId;
  /** model param id -> engine param id, resolved once per instance. */
  paramIds: Map<string, number>;
  written: Map<string, number>;
}

export class InstrumentHost {
  private live = new Map<TrackId, LiveInstrument>();

  constructor(private readonly runtime: AudioRuntime) {}

  private kindFor(kindId: string): InstrumentKind | undefined {
    const caps = this.runtime.getCapabilities?.();
    return caps?.instruments?.find((i) => i.id === kindId)?.kind;
  }

  /** Creates/recreates/removes engine instances so each synth track has exactly one, with its
   * current controls. A track whose bus isn't known yet, or whose kind this engine doesn't
   * provide, simply has no live instance (silent) until it does. */
  sync(project: Project, buses: TrackBusMap): void {
    const wanted = new Set<TrackId>();
    for (const track of project.tracks) {
      const inst = track.instrument;
      const bus = buses[track.id];
      if (!inst || bus === undefined) continue;
      wanted.add(track.id);

      let live = this.live.get(track.id);
      if (live && (live.kindId !== inst.kind || live.bus !== bus)) {
        this.runtime.removeInstrument(live.id);
        this.live.delete(track.id);
        live = undefined;
      }
      if (!live) {
        const kind = this.kindFor(inst.kind);
        if (kind === undefined) continue;
        let id: InstrumentId;
        try {
          id = this.runtime.createInstrument(kind, { bus });
        } catch {
          continue; // MAX_INSTRUMENTS or an engine-side rejection
        }
        const paramIds = new Map<string, number>();
        for (const p of this.runtime.getInstrumentParams(kind)) paramIds.set(p.name, p.id);
        live = { kindId: inst.kind, kind, bus, id, paramIds, written: new Map(), lfoSent: [] };
        this.live.set(track.id, live);
      }

      for (const [name, value] of Object.entries(inst.params)) {
        const paramId = live.paramIds.get(name);
        if (paramId === undefined || live.written.get(name) === value) continue;
        live.written.set(name, value);
        this.runtime.setInstrumentParameter(live.id, paramId, value);
      }
      this.syncLfos(live, inst.lfos ?? []);
    }

    for (const [trackId, live] of this.live) {
      if (wanted.has(trackId)) continue;
      this.runtime.removeInstrument(live.id);
      this.live.delete(trackId);
    }
  }

  /** Pushes the track's LFO slots (model TrackLfo -> webdsp setInstrumentLfo). Names are resolved
   * against the engine's own tables here, at the boundary: a waveform/division/target the engine
   * does not know (or no longer offers as a modulation target) leaves that slot off. */
  private syncLfos(live: LiveInstrument, lfos: readonly TrackLfo[]): void {
    const info = this.runtime.getModulationInfo?.();
    if (!info) return;
    const targets = new Set(this.runtime.getModulationTargets(live.kind).map((p) => p.name));
    for (let slot = 0; slot < info.maxLfos; slot++) {
      const lfo = lfos[slot];
      const waveform = lfo ? info.waveforms.indexOf(lfo.waveform) : -1;
      const division = lfo ? info.divisions.findIndex((d) => d.name === lfo.division) : -1;
      const target = lfo ? live.paramIds.get(lfo.target) : undefined;
      const valid = lfo && waveform >= 0 && target !== undefined && targets.has(lfo.target) && (!lfo.sync || division >= 0);
      const sig = valid ? JSON.stringify(lfo) : "";
      if (sig === (live.lfoSent[slot] ?? "")) continue;
      live.lfoSent[slot] = sig;
      if (valid) {
        this.runtime.setInstrumentLfo(live.id, slot, {
          target: target!,
          amount: lfo.amount,
          waveform,
          sync: lfo.sync,
          rateHz: lfo.rateHz,
          division: Math.max(0, division),
          phase: lfo.phase,
        });
      } else {
        this.runtime.clearInstrumentLfo(live.id, slot);
      }
    }
  }

  /** Plays a note on `trackId`'s instrument. Returns false if the track has none live. */
  noteOn(trackId: TrackId, params: InstrumentNoteParams): boolean {
    const live = this.live.get(trackId);
    if (!live) return false;
    this.runtime.instrumentNoteOn(live.id, params);
    return true;
  }

  /** Note-off for every live instrument — for Stop/Pause, so a held bass note doesn't ring on.
   * Pending (scheduled) notes are dropped separately by runtime.cancelScheduled(). */
  stopAll(): void {
    for (const live of this.live.values()) this.runtime.instrumentNoteOff(live.id);
  }
}

const hosts = new WeakMap<AudioRuntime, InstrumentHost>();

export function instrumentHostFor(runtime: AudioRuntime): InstrumentHost {
  let host = hosts.get(runtime);
  if (!host) {
    host = new InstrumentHost(runtime);
    hosts.set(runtime, host);
  }
  return host;
}
