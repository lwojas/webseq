import { useRef } from "react";
import type { NoteId, Track } from "../model/types";
import { notesForTrack, totalBeats, type SequencerState } from "../model/types";
import { NoteBlock } from "./NoteBlock";

interface Props {
  index: number;
  track: Track;
  state: SequencerState;
  selectedNoteId: NoteId | null;
  onSelectNote: (id: NoteId | null) => void;
  onAddNote: (start: number) => void;
  onResizeNote: (noteId: NoteId, duration: number) => void;
  onMoveNote: (noteId: NoteId, start: number) => void;
  onLoadSample: (file: File) => void;
}

export function TrackRow({
  index,
  track,
  state,
  selectedNoteId,
  onSelectNote,
  onAddNote,
  onResizeNote,
  onMoveNote,
  onLoadSample,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const beats = totalBeats(state);
  const notes = notesForTrack(state, track.id);

  return (
    <div className="track-row">
      <div className="track-header">
        <span className="track-num">{String(index + 1).padStart(2, "0")}</span>
        <span className={`track-name ${track.sampleId == null ? "unassigned" : ""}`}>
          {track.sampleId == null ? "— empty —" : track.name}
        </span>
        <button className="load-btn" onClick={() => fileInputRef.current?.click()}>
          Load
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onLoadSample(file);
            e.target.value = "";
          }}
        />
      </div>
      <div className="track-lane">
        <div className="cells">
          {Array.from({ length: beats }, (_, i) => (
            <button
              key={i}
              className={`cell ${i % 4 === 0 ? "bar-start" : ""}`}
              onClick={() => onAddNote(i)}
              aria-label={`beat ${i + 1}`}
            />
          ))}
        </div>
        {notes.map((note) => (
          <NoteBlock
            key={note.id}
            note={note}
            totalBeats={beats}
            selected={note.id === selectedNoteId}
            onSelect={() => onSelectNote(note.id)}
            onResize={(duration) => onResizeNote(note.id, duration)}
            onMove={(start) => onMoveNote(note.id, start)}
          />
        ))}
      </div>
    </div>
  );
}
