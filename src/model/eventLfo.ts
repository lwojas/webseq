// Track LFO model (webdsp docs/lfo-modulation.md covers the engine's own LFOs; this one is
// different): a track-level LFO that modulates *event* properties — today the velocity of notes —
// at the moment the sequencer schedules them. It never touches the synth, the stored note
// velocity, or the audio signal path; audio/trackLfo.ts evaluates it, audio/compile.ts applies it.
//
// Stored: the track's LfoConfig (Track.eventLfo) and each step's participation (Note.lfo).
// Not stored: the effective velocity — a runtime value of playback.

import type { LfoWaveformId, PatternId, Project, Track, TrackEventLfo, TrackId, NoteId } from "./types";
import { updatePattern } from "./project";
import { LFO_MAX_RATE_HZ, LFO_MIN_RATE_HZ } from "./instruments";

// Same range as the synth LFOs, so the UI shares one rate slider.
export const EVENT_LFO_MIN_RATE_HZ = LFO_MIN_RATE_HZ;
export const EVENT_LFO_MAX_RATE_HZ = LFO_MAX_RATE_HZ;
export const DEFAULT_EVENT_LFO_DIVISION = "1/4";

export function createEventLfo(): TrackEventLfo {
  return {
    enabled: false,
    target: "velocity",
    waveform: "sine",
    sync: true,
    rateHz: 1,
    division: DEFAULT_EVENT_LFO_DIVISION,
    depth: 0.25,
  };
}

/** The track's LFO, or the disabled default. */
export function eventLfoOf(track: Pick<Track, "eventLfo">): TrackEventLfo {
  return track.eventLfo ?? createEventLfo();
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** Edits the track's LFO (creating it, disabled, on first edit). Numeric fields are clamped. */
export function setTrackEventLfo(project: Project, trackId: TrackId, patch: Partial<TrackEventLfo>): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const next: TrackEventLfo = { ...eventLfoOf(t), ...patch };
      next.rateHz = clamp(next.rateHz, EVENT_LFO_MIN_RATE_HZ, EVENT_LFO_MAX_RATE_HZ);
      next.depth = clamp(next.depth, 0, 1);
      return { ...t, eventLfo: next };
    }),
  };
}

/** Sets one step's participation (0..1). 0 is stored as "absent" so notes that do not take part
 * stay byte-identical to notes saved before this existed. */
export function setNoteLfo(project: Project, patternId: PatternId, noteId: NoteId, amount: number): Project {
  return updatePattern(project, patternId, (p) => {
    const note = p.notes[noteId];
    if (!note) return p;
    const { lfo: _old, ...rest } = note;
    const a = Math.round(clamp(amount, 0, 1) * 100) / 100;
    return { ...p, notes: { ...p.notes, [noteId]: a === 0 ? rest : { ...rest, lfo: a } } };
  });
}

/** Sets participation for every step of one track in one pattern (the "All steps" / "None"
 * buttons). */
export function setTrackNotesLfo(project: Project, patternId: PatternId, trackId: TrackId, amount: number): Project {
  return updatePattern(project, patternId, (p) => {
    const a = Math.round(clamp(amount, 0, 1) * 100) / 100;
    const notes = { ...p.notes };
    for (const [id, note] of Object.entries(p.notes)) {
      if (note.trackId !== trackId) continue;
      const { lfo: _old, ...rest } = note;
      notes[id] = a === 0 ? rest : { ...rest, lfo: a };
    }
    return { ...p, notes };
  });
}

export type { LfoWaveformId };
