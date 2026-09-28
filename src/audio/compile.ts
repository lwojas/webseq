// The one place the tracker's musical model gets translated into webdsp's generic,
// application-agnostic ScheduledEvent[]. Nothing on the other side of this file (the
// engine) ever sees a "track", a "beat", or a "bar" — only samples, times, and durations.
// See ARCHITECTURE.md in the webdsp repo, "How future sequencers can integrate".

import type { ScheduledEvent } from "webdsp";
import type { Note, SequencerState, Track } from "../model/types";
import { notesForTrack, totalBeats } from "../model/types";

/** Seconds per grid beat (a sixteenth note in 4/4) at a given tempo. Deliberately
 * independent of `SequencerState.beatsPerBar`/`bars` — growing the loop from 1 bar to 4/8/16
 * bars later never changes what a single beat means in time, only how many of them there
 * are per loop. */
export function secondsPerBeat(tempo: number): number {
  return 60 / (tempo * 4);
}

/** Converts one note, for one iteration of the loop, into a webdsp ScheduledEvent. Returns
 * null if the track has no sample assigned yet (nothing to play). */
export function compileNote(
  track: Track,
  note: Note,
  tempo: number,
  loopStartTime: number,
  loopIndex: number,
  beatsPerLoop: number,
): ScheduledEvent | null {
  if (track.sampleId == null) return null;
  const spb = secondsPerBeat(tempo);
  const time = loopStartTime + (loopIndex * beatsPerLoop + note.start) * spb;
  return {
    sampleId: track.sampleId,
    time,
    duration: note.duration * spb,
    gain: note.velocity,
  };
}

/** Compiles every note in the pattern for one full loop iteration into ScheduledEvents.
 * Used both by the realtime Transport (see audio/transport.ts) and directly by tests —
 * this function touches no AudioRuntime, no timers, nothing realtime. */
export function compileLoopIteration(
  state: SequencerState,
  loopStartTime: number,
  loopIndex: number,
): ScheduledEvent[] {
  const beatsPerLoop = totalBeats(state);
  const events: ScheduledEvent[] = [];
  for (const track of state.tracks) {
    for (const note of notesForTrack(state, track.id)) {
      const event = compileNote(track, note, state.tempo, loopStartTime, loopIndex, beatsPerLoop);
      if (event) events.push(event);
    }
  }
  return events;
}
