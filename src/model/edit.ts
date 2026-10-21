// Edit-panel operations (clipboard + Bar Tools) — pure functions over Project, built on the
// existing building blocks: trackConfig.ts's CopiedTrackConfig/pasteTrackConfig (the track
// "reusable configuration" boundary), notes.ts's CopiedNote (the sequence boundary) and
// project.ts's note/pattern wrappers. Each clip is by-value plain data (no shared references with
// the project) and each paste regenerates ids (FX, notes), so a paste never aliases its source.
// No React, no webdsp.

import type {
  AssetId,
  AutomationLane,
  FxInstance,
  InstrumentKindId,
  PatternId,
  PlaybackMode,
  Project,
  Track,
  TrackEventLfo,
  TrackId,
  TrackInstrument,
  TrackLfo,
  VoiceMode,
} from "./types";
import { trackById } from "./types";
import { appendBarsCopy, type CopiedNote } from "./notes";
import { INSTRUMENT_DEFS } from "./instruments";
import { clearTrackNotes, pasteNotes, tracksInBank, updatePattern } from "./project";
import { cloneFxChain, cloneInstrument, copyTrackConfig, pasteTrackConfig, type CopiedTrackConfig } from "./trackConfig";

function updateTrack(project: Project, trackId: TrackId, update: (t: Track) => Track): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? update(t) : t)) };
}

function copyNotes(project: Project, patternId: PatternId, trackId: TrackId): CopiedNote[] {
  const pattern = project.patterns.find((p) => p.id === patternId);
  if (!pattern) return [];
  return Object.values(pattern.notes)
    .filter((n) => n.trackId === trackId)
    .sort((a, b) => a.start - b.start)
    .map((n) => ({ start: n.start, duration: n.duration, velocity: n.velocity, pitch: n.pitch, chord: n.chord, lfo: n.lfo }));
}

/** Replaces `trackId`'s notes in one pattern with `notes` (notes that don't fit a shorter
 * destination pattern are dropped by pasteNotes). */
function replaceNotes(project: Project, patternId: PatternId, trackId: TrackId, notes: CopiedNote[]): Project {
  return pasteNotes(clearTrackNotes(project, patternId, trackId), patternId, trackId, notes).project;
}

// --- Track: everything on the track — config (source, FX, modulation, modes, pan) + the sequence
// in the selected pattern. Mixer state (volume/mute/solo) stays with the destination, as in
// trackConfig.ts.

export interface TrackClip {
  config: CopiedTrackConfig;
  notes: CopiedNote[];
}

export function copyTrack(project: Project, trackId: TrackId, patternId: PatternId): TrackClip | null {
  const track = trackById(project, trackId);
  return track ? { config: copyTrackConfig(track), notes: copyNotes(project, patternId, trackId) } : null;
}

export function pasteTrack(project: Project, trackId: TrackId, patternId: PatternId, clip: TrackClip): Project {
  return replaceNotes(pasteTrackConfig(project, trackId, clip.config), patternId, trackId, clip.notes);
}

// --- Instrument: the sound source (sample asset or synth + params) and how it plays. Modulation
// is its own clip; a synth's LFO slots are kept out of this one.

export interface InstrumentClip {
  assetId: AssetId | null;
  instrument: TrackInstrument | null;
  playbackMode?: PlaybackMode;
  voiceMode?: VoiceMode;
}

export function hasInstrument(track: Track): boolean {
  return track.assetId != null || track.instrument != null;
}

export function copyInstrument(track: Track): InstrumentClip {
  const instrument = track.instrument ? cloneInstrument(track.instrument) : null;
  if (instrument) delete instrument.lfos;
  return { assetId: track.assetId, instrument, playbackMode: track.playbackMode, voiceMode: track.voiceMode };
}

/** Replaces the destination's source. Its synth LFO slots survive only if the synth kind is
 * unchanged (their targets are that kind's controls). A stale assetId falls back to null, like
 * pasteTrackConfig. */
export function pasteInstrument(project: Project, trackId: TrackId, clip: InstrumentClip): Project {
  const asset = clip.assetId != null ? project.assets.find((a) => a.id === clip.assetId) : undefined;
  return updateTrack(project, trackId, (t) => {
    const instrument = clip.instrument ? cloneInstrument(clip.instrument) : null;
    if (instrument && t.instrument?.kind === instrument.kind && t.instrument.lfos) {
      instrument.lfos = t.instrument.lfos.map((l) => ({ ...l }));
    }
    return {
      ...t,
      assetId: asset ? asset.id : null,
      instrument,
      name: asset ? asset.name : instrument ? (INSTRUMENT_DEFS[instrument.kind]?.label ?? t.name) : t.name,
      playbackMode: clip.playbackMode,
      voiceMode: clip.voiceMode,
    };
  });
}

// --- FX: the track's chain and its automation lanes (a lane is meaningless without its FX).

export interface FxClip {
  fx: FxInstance[];
  automation: AutomationLane[];
}

export function copyFx(track: Track): FxClip {
  return {
    fx: track.fx.map((f) => ({ ...f, params: { ...f.params } })),
    // Only FX lanes: a source lane (no fxId) belongs to the track's instrument/sample, not the chain.
    automation: track.automation.filter((a) => a.fxId != null).map((a) => ({ ...a, events: a.events.map((e) => ({ ...e })) })),
  };
}

export function pasteFx(project: Project, trackId: TrackId, clip: FxClip): Project {
  const { fx, automation } = cloneFxChain(clip.fx, clip.automation);
  return updateTrack(project, trackId, (t) => ({ ...t, fx, automation: [...t.automation.filter((a) => a.fxId == null), ...automation] }));
}

// --- Modulation: the synth's LFO slots and the track's event LFO.

export interface ModulationClip {
  /** The synth the slots were set up on; their targets are that kind's controls. */
  kind: InstrumentKindId | null;
  lfos: TrackLfo[];
  eventLfo?: TrackEventLfo;
}

export function hasModulation(track: Track): boolean {
  return (track.instrument?.lfos?.length ?? 0) > 0 || track.eventLfo != null;
}

export function copyModulation(track: Track): ModulationClip {
  return {
    kind: track.instrument?.kind ?? null,
    lfos: (track.instrument?.lfos ?? []).map((l) => ({ ...l })),
    eventLfo: track.eventLfo ? { ...track.eventLfo } : undefined,
  };
}

/** Whether the clip's synth LFO slots can be applied to `track` (same synth kind). The event LFO
 * has no such dependency. */
export function canPasteSynthLfos(track: Track, clip: ModulationClip): boolean {
  return clip.kind != null && track.instrument?.kind === clip.kind;
}

export function pasteModulation(project: Project, trackId: TrackId, clip: ModulationClip): Project {
  return updateTrack(project, trackId, (t) => {
    const next: Track = { ...t, eventLfo: clip.eventLfo ? { ...clip.eventLfo } : undefined };
    if (t.instrument && canPasteSynthLfos(t, clip)) {
      const instrument = cloneInstrument(t.instrument);
      if (clip.lfos.length > 0) instrument.lfos = clip.lfos.map((l) => ({ ...l }));
      else delete instrument.lfos;
      next.instrument = instrument;
    }
    return next;
  });
}

// --- Bank: all 16 tracks' configuration plus their sequences in every pattern.

export interface BankClip {
  /** One per track in the bank, in order. */
  configs: CopiedTrackConfig[];
  /** Per pattern id: one note list per track in the bank. */
  sequences: Record<PatternId, CopiedNote[][]>;
}

export function copyBank(project: Project, bank: number): BankClip {
  const tracks = tracksInBank(project, bank);
  const sequences: BankClip["sequences"] = {};
  for (const pattern of project.patterns) {
    sequences[pattern.id] = tracks.map((t) => copyNotes(project, pattern.id, t.id));
  }
  return { configs: tracks.map(copyTrackConfig), sequences };
}

/** Restores the clip onto `bank`: every track's configuration is replaced, and its notes in every
 * pattern are replaced by the clip's (empty for a pattern created after the copy). */
export function pasteBank(project: Project, bank: number, clip: BankClip): Project {
  const targets = tracksInBank(project, bank);
  let next = project;
  targets.forEach((target, i) => {
    const config = clip.configs[i];
    if (config) next = pasteTrackConfig(next, target.id, config);
  });
  for (const pattern of project.patterns) {
    const perTrack = clip.sequences[pattern.id];
    targets.forEach((target, i) => {
      next = replaceNotes(next, pattern.id, target.id, perTrack?.[i] ?? []);
    });
  }
  return next;
}

// --- Bar Tools ---

/** Doubles the pattern: appends a copy of the whole thing after its end. */
export function duplicateSequence(project: Project, patternId: PatternId): Project {
  return updatePattern(project, patternId, (p) => appendBarsCopy(p, project.beatsPerBar, 0, p.bars));
}

/** Appends a copy of bar `bar` (0-based) to the end of the pattern. */
export function duplicateBar(project: Project, patternId: PatternId, bar: number): Project {
  return updatePattern(project, patternId, (p) => appendBarsCopy(p, project.beatsPerBar, bar, 1));
}
