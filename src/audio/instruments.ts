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
// note retriggers it. That is the engine's rule, not the track's voiceMode. Chords are the one
// exception webseq makes: a track whose notes include a chord (model/chord.ts) gets one instance
// per chord tone — "chords/layers = more instances" is webdsp's documented contract — and tone i
// of every chord always plays on instance i. Every control, LFO and automation lane is applied
// to all of a track's instances, so they sound as one instrument. Tracks without chords keep
// exactly one instance, as before.
import type { AudioRuntime, BusId, InstrumentId, InstrumentKind, InstrumentNoteParams } from "webdsp";
import type { Project, TrackId, TrackLfo } from "../model/types";
import type { TrackBusMap } from "./buses";
import { syncLfoSlots } from "./lfoSync";
import { chordVoicesNeeded } from "../model/chord";

interface LiveInstrument {
  kindId: string;
  kind: InstrumentKind;
  /** Last LFO config pushed per slot ("" = slot empty), so unchanged slots are never resent. */
  lfoSent: string[];
  bus: BusId;
  /** One engine instance per chord tone the track needs (at least one); ids[0] is the primary. */
  ids: InstrumentId[];
  /** model param id -> engine param id, resolved once per instance. */
  paramIds: Map<string, number>;
  /** Last project value pushed by sync(), so sync only reacts to a user edit. */
  base: Map<string, number>;
  /** Value currently in the engine (sync or automation). */
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
    const voicesNeeded = chordVoicesNeeded(project);
    for (const track of project.tracks) {
      const inst = track.instrument;
      const bus = buses[track.id];
      if (!inst || bus === undefined) continue;
      wanted.add(track.id);

      let live = this.live.get(track.id);
      if (live && (live.kindId !== inst.kind || live.bus !== bus)) {
        for (const id of live.ids) this.runtime.removeInstrument(id);
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
        live = { kindId: inst.kind, kind, bus, ids: [id], paramIds, base: new Map(), written: new Map(), lfoSent: [] };
        this.live.set(track.id, live);
      }

      const wantedVoices = voicesNeeded.get(track.id) ?? 1;
      while (live.ids.length > wantedVoices) this.runtime.removeInstrument(live.ids.pop()!);
      while (live.ids.length < wantedVoices) {
        let extra: InstrumentId;
        try {
          extra = this.runtime.createInstrument(live.kind, { bus });
        } catch {
          break; // out of instances: extra chord tones fall back to the last one that exists
        }
        live.ids.push(extra);
        // A new instance has the engine defaults: resend every control and LFO to it.
        live.base.clear();
        live.written.clear();
        live.lfoSent = [];
      }

      for (const [name, value] of Object.entries(inst.params)) {
        const paramId = live.paramIds.get(name);
        if (paramId === undefined || live.base.get(name) === value) continue;
        live.base.set(name, value);
        live.written.set(name, value);
        for (const id of live.ids) this.runtime.setInstrumentParameter(id, paramId, value);
      }
      this.syncLfos(live, inst.lfos ?? []);
    }

    for (const [trackId, live] of this.live) {
      if (wanted.has(trackId)) continue;
      for (const id of live.ids) this.runtime.removeInstrument(id);
      this.live.delete(trackId);
    }
  }

  /** Pushes the track's LFO slots (model TrackLfo -> webdsp setInstrumentLfo); see lfoSync.ts. */
  private syncLfos(live: LiveInstrument, lfos: readonly TrackLfo[]): void {
    const info = this.runtime.getModulationInfo?.();
    if (!info) return;
    const targets = new Map<string, number>();
    for (const p of this.runtime.getModulationTargets(live.kind)) targets.set(p.name, p.id);
    syncLfoSlots(
      info,
      lfos,
      targets,
      live.lfoSent,
      (slot, lfo) => live.ids.forEach((id) => this.runtime.setInstrumentLfo(id, slot, lfo)),
      (slot) => live.ids.forEach((id) => this.runtime.clearInstrumentLfo(id, slot)),
    );
  }

  /** Writes one (automated) control value straight to the live instrument for `trackId`. Like
   * FxChainSync.setParam: a no-op if the track has no live synth, the control is unknown, or the
   * value is already in the engine. While an LFO targets the control the engine treats this as
   * the base value and adds the LFO on top. */
  setParam(trackId: TrackId, name: string, value: number): void {
    const live = this.live.get(trackId);
    const paramId = live?.paramIds.get(name);
    if (!live || paramId === undefined || live.written.get(name) === value) return;
    live.written.set(name, value);
    for (const id of live.ids) this.runtime.setInstrumentParameter(id, paramId, value);
  }

  /** The engine targets of one control of `trackId`'s live synth (one per instance), for scheduled
   * parameter events (audio/automation.ts); empty if the track has no live synth or the control is
   * unknown. */
  targets(trackId: TrackId, name: string): { instrument: InstrumentId; param: number }[] {
    const live = this.live.get(trackId);
    const param = live?.paramIds.get(name);
    return live && param !== undefined ? live.ids.map((instrument) => ({ instrument, param })) : [];
  }

  /** Records that automation has been told to move `name` to `value` (scheduled), so restoreBase()
   * puts the project value back when playback halts. */
  markWritten(trackId: TrackId, name: string, value: number): void {
    this.live.get(trackId)?.written.set(name, value);
  }

  /** Puts every control that automation moved away from its project value back to it (called when
   * playback halts, like FxChainSync.restoreBase). */
  restoreBase(): void {
    for (const live of this.live.values()) {
      for (const [name, base] of live.base) {
        const paramId = live.paramIds.get(name);
        if (paramId === undefined || live.written.get(name) === base) continue;
        live.written.set(name, base);
        for (const id of live.ids) this.runtime.setInstrumentParameter(id, paramId, base);
      }
    }
  }

  /** Plays a note on `trackId`'s instrument; `voice` is the chord tone (0 for an ordinary note),
   * which picks the instance. Returns false if the track has none live. */
  noteOn(trackId: TrackId, params: InstrumentNoteParams, voice = 0): boolean {
    const live = this.live.get(trackId);
    if (!live) return false;
    this.runtime.instrumentNoteOn(live.ids[Math.min(voice, live.ids.length - 1)], params);
    return true;
  }

  /** Note-off for one synth track's instrument (a released key; sustained synths enter their release). */
  noteOff(trackId: TrackId): void {
    const live = this.live.get(trackId);
    if (live) for (const id of live.ids) this.runtime.instrumentNoteOff(id);
  }

  /** Note-off for every live instrument — for Stop/Pause, so a held bass note doesn't ring on.
   * Pending (scheduled) notes are dropped separately by runtime.cancelScheduled(). */
  stopAll(): void {
    for (const live of this.live.values()) for (const id of live.ids) this.runtime.instrumentNoteOff(id);
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
