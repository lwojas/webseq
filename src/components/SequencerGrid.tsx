import type { NoteId, TrackId } from "../model/types";
import { totalBeats, type SequencerState } from "../model/types";
import { usePlayheadAnimation } from "../hooks/usePlayheadAnimation";
import { TrackRow } from "./TrackRow";

interface Props {
  state: SequencerState;
  selectedNoteId: NoteId | null;
  onSelectNote: (id: NoteId | null) => void;
  onAddNote: (trackId: TrackId, start: number) => void;
  onResizeNote: (noteId: NoteId, duration: number) => void;
  onMoveNote: (noteId: NoteId, start: number) => void;
  onLoadSample: (trackId: TrackId, file: File) => void;
  getPlayheadBeat: () => number;
}

export function SequencerGrid({
  state,
  selectedNoteId,
  onSelectNote,
  onAddNote,
  onResizeNote,
  onMoveNote,
  onLoadSample,
  getPlayheadBeat,
}: Props) {
  const beats = totalBeats(state);
  const playheadRef = usePlayheadAnimation(getPlayheadBeat, () => beats);

  return (
    <div className="sequencer" onClick={() => onSelectNote(null)}>
      <div className="grid-header">
        <div className="track-col-label">Track / Sample</div>
        <div className="beat-ruler">
          {Array.from({ length: beats }, (_, i) => (
            <div key={i} className={`beat-num ${i % 4 === 0 ? "bar-start" : ""}`}>
              {i + 1}
            </div>
          ))}
        </div>
      </div>
      <div className="track-rows">
        {state.tracks.map((track, i) => (
          <div key={track.id} onClick={(e) => e.stopPropagation()}>
            <TrackRow
              index={i}
              track={track}
              state={state}
              selectedNoteId={selectedNoteId}
              onSelectNote={onSelectNote}
              onAddNote={(start) => onAddNote(track.id, start)}
              onResizeNote={onResizeNote}
              onMoveNote={onMoveNote}
              onLoadSample={(file) => onLoadSample(track.id, file)}
            />
          </div>
        ))}
        <div className="playhead-wrapper">
          <div className="playhead" ref={playheadRef} />
        </div>
      </div>
    </div>
  );
}
