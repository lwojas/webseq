import type { NoteId, SequencerState, TrackId } from "./types";
import * as pattern from "./pattern";

export type Action =
  | { type: "SET_TEMPO"; tempo: number }
  | { type: "ASSIGN_SAMPLE"; trackId: TrackId; sampleId: number; name: string }
  | { type: "ADD_NOTE"; trackId: TrackId; start: number }
  | { type: "REMOVE_NOTE"; noteId: NoteId }
  | { type: "RESIZE_NOTE"; noteId: NoteId; duration: number }
  | { type: "MOVE_NOTE"; noteId: NoteId; start: number }
  | { type: "SET_BARS"; bars: number };

export function sequencerReducer(state: SequencerState, action: Action): SequencerState {
  switch (action.type) {
    case "SET_TEMPO":
      return pattern.setTempo(state, action.tempo);
    case "ASSIGN_SAMPLE":
      return pattern.assignSample(state, action.trackId, action.sampleId, action.name);
    case "ADD_NOTE":
      return pattern.addNote(state, action.trackId, action.start);
    case "REMOVE_NOTE":
      return pattern.removeNote(state, action.noteId);
    case "RESIZE_NOTE":
      return pattern.resizeNote(state, action.noteId, action.duration);
    case "MOVE_NOTE":
      return pattern.moveNote(state, action.noteId, action.start);
    case "SET_BARS":
      return pattern.setBars(state, action.bars);
  }
}
