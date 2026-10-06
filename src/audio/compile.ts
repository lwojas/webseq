// The one place the tracker's musical model gets translated into webdsp's generic,
// application-agnostic ScheduledEvent[]. Nothing on the other side of this file (the engine)
// ever sees a "track", a "beat", a "bar", or a "pattern" — only samples, times, durations,
// and which bus a voice's output sums into. See webdsp's ARCHITECTURE.md, "How future
// sequencers can integrate".

import type { BusId, ScheduledEvent } from "webdsp";
import type { Note, Pattern, Track, TrackId } from "../model/types";
import { effectivePlaybackMode, effectiveVoiceMode } from "../model/types";

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
 * grid position in 16th-note units (Note.start — since ECS-52, a note may start at a
 * fractional sub-step position under micro-timing, so this floors to the *containing* 16th
 * before checking parity — a note anywhere within 16th #5 belongs to that odd slot and swings
 * the same fixed amount as one starting exactly on it). */
export function swingOffsetSeconds(sixteenthIndex: number, swing: number, sixteenthDuration: number): number {
  if (Math.floor(sixteenthIndex) % 2 === 0) return 0;
  return sixteenthDuration * (swing - 0.5);
}

/** Converts one note into a webdsp ScheduledEvent for one playthrough of its pattern,
 * starting at `stepStartTime` (absolute engine time). Returns null if the track has no
 * sample assigned yet (nothing to play). `busId` routes the voice into that track's own FX
 * chain (see src/audio/buses.ts) — omitted entirely (rather than passed as undefined) when
 * the track has none yet, so webdsp's own MASTER_BUS default applies. `swing` (default 0.5,
 * straight) only offsets this note's scheduled *time* — never its duration, the stored
 * Note.start, nor the BPM — see swingOffsetSeconds.
 *
 * `duration` is always set (ECS-82): for a one-shot track (effectivePlaybackMode's default)
 * this is unchanged from before — the note's own length, auto-releasing the voice at its end.
 * For a loop-mode track, `loop: true` is added on top of the same bounded `duration`, so the
 * asset tiles/repeats to fill the note's length instead of just playing once — a loop voice is
 * still never unbounded, it's always cut by this same duration. */
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
  if (effectivePlaybackMode(track) === "loop") event.loop = true;
  return event;
}

/** Compiles every note in one pattern, for one playthrough starting at `stepStartTime`, into
 * ScheduledEvents. Used both by the realtime Transport (see audio/transport.ts) and directly
 * by tests — this function touches no AudioRuntime, no timers, nothing realtime. A thin
 * track-agnostic wrapper over compilePatternIterationTracked (below) for every caller that
 * doesn't need to know which track produced which event. */
export function compilePatternIteration(
  pattern: Pattern,
  tracks: Track[],
  bpm: number,
  stepStartTime: number,
  busIdFor: (trackId: string) => BusId | undefined = () => undefined,
  swing = 0.5,
): ScheduledEvent[] {
  return compilePatternIterationTracked(pattern, tracks, bpm, stepStartTime, busIdFor, swing).map((r) => r.event);
}

/** Same as compilePatternIteration, but keeps each ScheduledEvent paired with the TrackId that
 * produced it. webdsp's ScheduledEvent is deliberately track-agnostic (see this file's module
 * doc comment), so that identity would otherwise be lost the moment events are flattened —
 * Transport needs it (ECS-82/ECS-87) to apply its per-track mono voice choke after scheduling.
 *
 * Also where mono voice mode (Track.voiceMode, see types.ts) is enforced *within* one compiled
 * iteration: a pattern's own notes can never overlap at their authored grid positions (see
 * notes.ts's fitsWithoutOverlap), but swing can still delay one note's actual engine `time`
 * enough to bleed into the next note's start (see swingOffsetSeconds) — so this compares the
 * already-swung, already-compiled `time`s rather than re-deriving grid positions, and only
 * ever shortens a voice's duration to close that gap, never extends one past its authored
 * length. This only ever reaches within a single iteration; a mono track's last note bleeding
 * into the *next* iteration (or a manual trigger landing mid-voice — see ECS-83) isn't
 * visible here and is instead handled by the shared last-voice-per-track table in
 * audio/playback.ts, which Transport registers every mono voice with. */
export function compilePatternIterationTracked(
  pattern: Pattern,
  tracks: Track[],
  bpm: number,
  stepStartTime: number,
  busIdFor: (trackId: string) => BusId | undefined = () => undefined,
  swing = 0.5,
): { event: ScheduledEvent; trackId: TrackId }[] {
  const results: { event: ScheduledEvent; trackId: TrackId }[] = [];
  const notesByTrack = groupNotesByTrack(pattern);
  for (const track of tracks) {
    const busId = busIdFor(track.id);
    const trackEvents: ScheduledEvent[] = [];
    for (const note of notesByTrack.get(track.id) ?? []) {
      const event = compileNote(track, note, bpm, stepStartTime, busId, swing);
      if (event) trackEvents.push(event);
    }
    if (effectiveVoiceMode(track) === "mono") {
      for (let i = 0; i < trackEvents.length - 1; i++) {
        const current = trackEvents[i];
        const gap = trackEvents[i + 1].time - current.time;
        if (current.duration !== undefined && current.duration > gap) current.duration = Math.max(0, gap);
      }
    }
    for (const event of trackEvents) results.push({ event, trackId: track.id });
  }
  return results;
}

/** One pass over the pattern, instead of one scan per track: with 64 tracks, a scan per track
 * costs 64 full passes over the notes on every pattern iteration. Each list is sorted by start,
 * the same order notesForTrack gives. */
function groupNotesByTrack(pattern: Pattern): Map<TrackId, Note[]> {
  const byTrack = new Map<TrackId, Note[]>();
  for (const note of Object.values(pattern.notes)) {
    const list = byTrack.get(note.trackId);
    if (list) list.push(note);
    else byTrack.set(note.trackId, [note]);
  }
  for (const list of byTrack.values()) list.sort((a, b) => a.start - b.start);
  return byTrack;
}
