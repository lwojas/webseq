// The tracker's own sequencing model. Deliberately independent of React and of webdsp:
// nothing here imports "webdsp" or any React type. See src/audio/compile.ts for the one
// place this model gets translated into webdsp's generic ScheduledEvent[].

export type TrackId = string;
export type NoteId = string;

/** A single track/pad. Generic on purpose — the model has no idea what "kick" or "snare"
 * means, only that a track has a sample assigned to it (or not) and a list of notes. */
export interface Track {
  id: TrackId;
  /** The webdsp SampleId this track plays, or null if no sample has been assigned yet.
   * Kept as a plain number here rather than importing webdsp's SampleId type alias, so this
   * file has zero dependency on the audio-engine package. */
  sampleId: number | null;
  /** Display name — the assigned sample's filename by default, editable later if needed. */
  name: string;
}

/** One musical event on a track. Position and duration are in "beats" — a fixed grid unit
 * (a sixteenth note in 4/4; see src/audio/compile.ts's secondsPerBeat) independent of how
 * many beats make up a bar, so growing the pattern from 1 bar to 4/8/16 bars later only
 * ever changes `SequencerState.bars`, never what a beat means in time. */
export interface Note {
  id: NoteId;
  trackId: TrackId;
  /** Start position in beats from the start of the pattern (loop), 0-based. */
  start: number;
  /** Length in beats. Always > 0. */
  duration: number;
  /** 0..1, forwarded to the engine as gain. */
  velocity: number;
}

/** The entire sequencer's state: illustrative of the brief's example shape, but tracks and
 * notes are kept as flat, independently-addressable collections (a Record) rather than
 * nested arrays, so adding/removing/resizing a note never requires rebuilding a fixed-size
 * grid array. */
export interface SequencerState {
  tempo: number; // BPM, 40..240
  /** Steps per bar — the grid's horizontal resolution. Fixed at 16 for this prototype but
   * not hardcoded as a constant anywhere outside this field. */
  beatsPerBar: number;
  /** How many bars the pattern loops over. Starts at 1; nothing about this model prevents
   * growing it to 4/8/16 later. */
  bars: number;
  tracks: Track[];
  notes: Record<NoteId, Note>;
}

export function totalBeats(state: Pick<SequencerState, "bars" | "beatsPerBar">): number {
  return state.bars * state.beatsPerBar;
}

export function notesForTrack(state: SequencerState, trackId: TrackId): Note[] {
  const result: Note[] = [];
  for (const note of Object.values(state.notes)) {
    if (note.trackId === trackId) result.push(note);
  }
  return result.sort((a, b) => a.start - b.start);
}
