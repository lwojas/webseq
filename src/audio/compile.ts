// The one place the tracker's musical model gets translated into webdsp's generic,
// application-agnostic ScheduledEvent[]. Nothing on the other side of this file (the engine)
// ever sees a "track", a "beat", a "bar", or a "pattern" — only samples, times, durations,
// and which bus a voice's output sums into. See webdsp's ARCHITECTURE.md, "How future
// sequencers can integrate".

import type { BusId, ScheduledEvent } from "webdsp";
import type { Note, Pattern, Track } from "../model/types";
import { notesForTrack } from "../model/types";

/** Seconds per grid beat (a sixteenth note in 4/4) at a given BPM. Deliberately independent
 * of Project.beatsPerBar/Pattern.bars — growing a pattern to more bars, or adding more
 * patterns, never changes what a single beat means in time, only how many of them there are
 * in a given pattern. */
export function secondsPerBeat(bpm: number): number {
  return 60 / (bpm * 4);
}

/** Delay (seconds) applied to a 16th-note grid position for global swing. Swing only moves
 * the *second* 16th of each straight pair — the pair as a whole still spans exactly two
 * straight 16th-note durations, so it never shifts where the *next* pair starts and never
 * accumulates drift across beats/bars/loops. `swing` is the proportion of the pair occupied
 * by its first 16th (0.5 = straight/no-op, 0.75 = strong swing); `sixteenthIndex` is a note's
 * grid position in 16th-note units (Note.start — always an integer, see model/notes.ts). */
export function swingOffsetSeconds(sixteenthIndex: number, swing: number, sixteenthDuration: number): number {
  if (sixteenthIndex % 2 === 0) return 0;
  return sixteenthDuration * (swing - 0.5);
}

/** Converts one note into a webdsp ScheduledEvent for one playthrough of its pattern,
 * starting at `stepStartTime` (absolute engine time). Returns null if the track has no
 * sample assigned yet (nothing to play). `busId` routes the voice into that track's own FX
 * chain (see src/audio/buses.ts) — omitted entirely (rather than passed as undefined) when
 * the track has none yet, so webdsp's own MASTER_BUS default applies. `swing` (default 0.5,
 * straight) only offsets this note's scheduled *time* — never its duration, the stored
 * Note.start, nor the BPM — see swingOffsetSeconds. */
export function compileNote(
  track: Track,
  note: Note,
  bpm: number,
  stepStartTime: number,
  busId?: BusId,
  swing = 0.5,
): ScheduledEvent | null {
  if (track.assetId == null) return null;
  const spb = secondsPerBeat(bpm);
  const event: ScheduledEvent = {
    sampleId: track.assetId,
    time: stepStartTime + note.start * spb + swingOffsetSeconds(note.start, swing, spb),
    duration: note.duration * spb,
    gain: note.velocity,
  };
  if (busId !== undefined) event.bus = busId;
  return event;
}

/** Compiles every note in one pattern, for one playthrough starting at `stepStartTime`, into
 * ScheduledEvents. Used both by the realtime Transport (see audio/transport.ts) and directly
 * by tests — this function touches no AudioRuntime, no timers, nothing realtime. */
export function compilePatternIteration(
  pattern: Pattern,
  tracks: Track[],
  bpm: number,
  stepStartTime: number,
  busIdFor: (trackId: string) => BusId | undefined = () => undefined,
  swing = 0.5,
): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];
  for (const track of tracks) {
    const busId = busIdFor(track.id);
    for (const note of notesForTrack(pattern, track.id)) {
      const event = compileNote(track, note, bpm, stepStartTime, busId, swing);
      if (event) events.push(event);
    }
  }
  return events;
}
