// Manual voices (ECS-83): everything that plays outside the sequencer. Two channels share one
// engine path and one mono-choke table:
//   - audition: an Asset played raw to MASTER_BUS, one at a time, at a fixed preview gain.
//   - track: a Track's sample played through its own bus (so its FX, volume, mute and solo
//     apply), one-shot or as a toggled loop, following the track's playbackMode/voiceMode.
// The sequencer (audio/transport.ts) registers its mono voices here too, so a manual trigger
// on a mono track chokes the sequenced voice and vice versa.
//
// Immediate triggers are not scheduled, so Transport's runtime.cancelScheduled() never reaches
// them. Stop goes through Transport.stop(), which calls stopAll() here explicitly.
import type { AudioRuntime, BusId, VoiceHandle } from "webdsp";
import type { AssetId, FxTarget, Project, Track, TrackId } from "../model/types";
import { effectivePlaybackMode, effectiveVoiceMode, trackById } from "../model/types";

/** Fixed audition level (about -2 dB). There is deliberately no preview-level control yet —
 * see docs/audio-auditioning-and-manual-triggering.md, "Deferrals". */
export const AUDITION_GAIN = 0.8;

type VoiceOwner = "sequencer" | "manual";

/** What the UI needs to draw active states. Only handed out when something actually changed. */
export interface ManualPlaybackSnapshot {
  auditionAssetId: AssetId | null;
  loopingTrackIds: TrackId[];
}

interface Audition {
  assetId: AssetId;
  handle: VoiceHandle;
}

interface TrackLoop {
  assetId: AssetId;
  handle: VoiceHandle;
}

export class Playback {
  /** Last voice per mono track, from either owner — the choke target for the next mono voice. */
  private lastMono = new Map<TrackId, { handle: VoiceHandle; owner: VoiceOwner }>();
  private loops = new Map<TrackId, TrackLoop>();
  private audition: Audition | null = null;
  private listeners = new Set<(snapshot: ManualPlaybackSnapshot) => void>();

  constructor(
    private readonly runtime: AudioRuntime,
    private readonly getBusId: (target: FxTarget) => BusId | undefined,
    /** True while a resample is armed or capturing. Manual starts are refused then, because
     * armCapture records master output and anything played now would be baked into the asset. */
    private readonly isCaptureBusy: () => boolean,
  ) {
    runtime.onVoiceEnded((voice) => this.forget(voice));
  }

  subscribe(fn: (snapshot: ManualPlaybackSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): ManualPlaybackSnapshot {
    return {
      auditionAssetId: this.audition?.assetId ?? null,
      loopingTrackIds: [...this.loops.keys()],
    };
  }

  // --- choke table (shared with the sequencer) ---

  /** Records `handle` as the newest voice on a mono track, releasing whichever voice held that
   * slot. Called by Transport for every mono sequenced voice, and by the manual paths below.
   * Poly tracks never call this, so their voices stack. */
  registerMonoVoice(trackId: TrackId, handle: VoiceHandle, owner: VoiceOwner): void {
    const previous = this.lastMono.get(trackId);
    if (previous) {
      this.runtime.release(previous.handle);
      // Choking the track's manual loop also ends the loop, so the toggle must not still show it.
      const loop = this.loops.get(trackId);
      if (loop && loop.handle === previous.handle) this.loops.delete(trackId);
    }
    this.lastMono.set(trackId, { handle, owner });
  }

  /** Forgets sequenced entries after Transport has released them itself (pause, stop, play). */
  dropSequencerVoices(): void {
    for (const [trackId, entry] of this.lastMono) {
      if (entry.owner === "sequencer") this.lastMono.delete(trackId);
    }
  }

  // --- audition ---

  /** Plays `assetId` once, or stops it if it is already the one auditioning. Starting another
   * asset releases the current audition first. Returns false if the start was refused. */
  auditionAsset(assetId: AssetId): boolean {
    if (this.audition?.assetId === assetId) {
      this.stopAudition();
      return true;
    }
    if (this.isCaptureBusy()) return false;
    this.stopAudition();
    const handle = this.runtime.trigger({ sampleId: assetId, gain: AUDITION_GAIN });
    this.audition = { assetId, handle };
    this.notify();
    return true;
  }

  stopAudition(): void {
    if (!this.audition) return;
    this.runtime.release(this.audition.handle);
    this.audition = null;
    this.notify();
  }

  // --- track triggering ---

  /** The track's button: a one-shot for one-shot tracks, a start/stop toggle for loop tracks.
   * Returns false if the track has nothing to play or the start was refused. */
  pressTrack(track: Track): boolean {
    return effectivePlaybackMode(track) === "loop" ? this.toggleTrackLoop(track) : this.triggerTrackOnce(track);
  }

  triggerTrackOnce(track: Track): boolean {
    const target = this.trackTarget(track);
    if (!target) return false;
    const handle = this.runtime.trigger({ sampleId: target.assetId, bus: target.bus });
    if (effectiveVoiceMode(track) === "mono") this.registerMonoVoice(track.id, handle, "manual");
    return true;
  }

  toggleTrackLoop(track: Track): boolean {
    const existing = this.loops.get(track.id);
    if (existing) {
      this.runtime.release(existing.handle);
      this.loops.delete(track.id);
      this.notify();
      return true;
    }
    const target = this.trackTarget(track);
    if (!target) return false;
    const handle = this.runtime.trigger({ sampleId: target.assetId, bus: target.bus, loop: true });
    this.loops.set(track.id, { assetId: target.assetId, handle });
    if (effectiveVoiceMode(track) === "mono") this.registerMonoVoice(track.id, handle, "manual");
    this.notify();
    return true;
  }

  /** Only starts are refused, never stops: a loop must always be stoppable. */
  private trackTarget(track: Track): { assetId: AssetId; bus: BusId } | null {
    if (track.assetId == null || this.isCaptureBusy()) return null;
    const bus = this.getBusId(track.id);
    if (bus === undefined) return null;
    return { assetId: track.assetId, bus };
  }

  // --- lifecycle ---

  /** Silences every manual voice. Transport.stop() calls this on every Stop, including when
   * the transport was already stopped, so Stop is always the universal silence. */
  stopAll(): void {
    for (const loop of this.loops.values()) this.runtime.release(loop.handle);
    this.loops.clear();
    for (const [trackId, entry] of this.lastMono) {
      if (entry.owner === "manual") this.lastMono.delete(trackId);
    }
    if (this.audition) {
      this.runtime.release(this.audition.handle);
      this.audition = null;
    }
    this.notify();
  }

  /** Ends manual voices whose asset no longer matches the project: a track reassigned or
   * cleared while looping, or an audition whose asset was removed. Called after every project
   * change, so it must stay cheap (it scans at most one entry per track). */
  reconcile(project: Project): void {
    let changed = false;
    for (const [trackId, loop] of this.loops) {
      if (trackById(project, trackId)?.assetId !== loop.assetId) {
        this.runtime.release(loop.handle);
        this.loops.delete(trackId);
        changed = true;
      }
    }
    if (this.audition && !project.assets.some((a) => a.id === this.audition?.assetId)) {
      this.runtime.release(this.audition.handle);
      this.audition = null;
      changed = true;
    }
    if (changed) this.notify();
  }

  /** A voice finished on its own (sample ended, or its release fade completed). Clears any
   * state that pointed at it so the UI and the choke table never refer to a dead voice. */
  private forget(voice: VoiceHandle): void {
    let changed = false;
    for (const [trackId, loop] of this.loops) {
      if (loop.handle === voice) {
        this.loops.delete(trackId);
        changed = true;
      }
    }
    if (this.audition?.handle === voice) {
      this.audition = null;
      changed = true;
    }
    for (const [trackId, entry] of this.lastMono) {
      if (entry.handle === voice) this.lastMono.delete(trackId);
    }
    if (changed) this.notify();
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const fn of this.listeners) fn(snapshot);
  }
}
