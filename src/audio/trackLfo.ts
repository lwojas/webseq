// Evaluates a track's event LFO for one note. This is the sequencer-side half of the Track LFO:
// webdsp owns the LFO maths (lfoValueAt, mirrored from the engine and parity-tested there); this
// file only decides *what the value does to the event*. No clock of its own: the caller passes the
// event's scheduled time and the transport's anchor/tempo, so the result is a pure function of
// (project, transport anchor, event time) — deterministic, and correct for events scheduled ahead
// of the audio clock.
import { LFO_DIVISIONS, LfoWaveform, lfoValueAt } from "webdsp";
import type { Note, Track, TrackEventLfo } from "../model/types";
import { pitchOptions } from "../model/pitchOptions";
import { normalizeScale, type ProjectScale } from "../model/scale";

const WAVEFORMS: Record<string, LfoWaveform> = {
  sine: LfoWaveform.Sine,
  triangle: LfoWaveform.Triangle,
  square: LfoWaveform.Square,
  saw: LfoWaveform.Saw,
  "sample & hold": LfoWaveform.SampleHold,
};

/** The transport timing an event LFO is evaluated against. */
export interface EventLfoClock {
  /** Engine time of the transport anchor (the same anchor given to runtime.setTempo): cycle 0
   * starts here in both free and BPM-synced mode. It is set at play/resume/tempo change, and is
   * not reset by pattern changes. */
  anchorTime: number;
  bpm: number;
}

/** The LFO's output, -1..1, at `eventTime`. */
export function eventLfoValue(lfo: TrackEventLfo, eventTime: number, clock: EventLfoClock): number {
  const division = LFO_DIVISIONS.findIndex((d) => d.name === lfo.division);
  return lfoValueAt(
    {
      waveform: WAVEFORMS[lfo.waveform] ?? LfoWaveform.Sine,
      sync: lfo.sync,
      rateHz: lfo.rateHz,
      division: division >= 0 ? division : LFO_DIVISIONS.findIndex((d) => d.name === "1/4"),
    },
    { time: eventTime, anchorTime: clock.anchorTime, bpm: clock.bpm },
  );
}

/** The velocity a note should be played with when scheduled at `eventTime`. Returns the note's own
 * velocity untouched when the track has no enabled LFO, the note does not participate, or no
 * clock is available. The stored note is never modified. Target dispatch lives here so a future
 * event property is one more case, not a change to the compile step. */
export function effectiveVelocity(track: Pick<Track, "eventLfo">, note: Note, eventTime: number, clock?: EventLfoClock): number {
  const lfo = track.eventLfo;
  const participation = note.lfo ?? 0;
  if (!clock || !lfo || !lfo.enabled || participation <= 0) return note.velocity;
  switch (lfo.target) {
    case "pitch":
      return note.velocity;
    case "velocity": {
      const v = note.velocity + eventLfoValue(lfo, eventTime, clock) * lfo.depth * participation;
      return Math.min(1, Math.max(0, v));
    }
  }
  return note.velocity;
}

/** What the pitch target needs to know about the track: its root note (null for a sample), how many
 * slices a chop track has (null when not chop), and the project scale (Snap trims the options). */
export interface PitchLfoContext {
  root: number | null;
  slices: number | null;
  scale?: Partial<ProjectScale> | null;
}

/** The pitch (semitone offset, or slice number on a chop track) a note should play at when
 * scheduled at `eventTime`. The LFO moves the note along the options its Pitch dropdown offers
 * (ascending), `lfo x depth x participation x (options - 1)` places from where it is set, clamped
 * to the ends. Untouched when the target is not "pitch", the LFO is off, the note does not take
 * part, or no clock is available. */
export function effectivePitch(track: Pick<Track, "eventLfo">, note: Note, eventTime: number, clock: EventLfoClock | undefined, ctx: PitchLfoContext): number | undefined {
  const base = note.pitch;
  const lfo = track.eventLfo;
  const participation = note.lfo ?? 0;
  if (!clock || !lfo || !lfo.enabled || lfo.target !== "pitch" || participation <= 0) return base;
  const current = base ?? 0;
  const options = pitchOptions(ctx.root, current, ctx.slices, normalizeScale(ctx.scale)).sort((a, b) => a - b);
  const at = options.indexOf(current);
  if (at < 0) return base;
  const places = Math.round(eventLfoValue(lfo, eventTime, clock) * lfo.depth * participation * (options.length - 1));
  return options[Math.min(options.length - 1, Math.max(0, at + places))];
}
