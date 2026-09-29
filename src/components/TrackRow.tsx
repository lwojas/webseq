import { useRef } from "react";
import type { NoteId, Pattern, Track } from "../model/types";
import { notesForTrack, totalBeats } from "../model/types";
import { NoteBlock } from "./NoteBlock";
import { BEAT_WIDTH_PX } from "./timelineConstants";

interface Props {
  index: number;
  track: Track;
  pattern: Pattern;
  beatsPerBar: number;
  selected: boolean;
  selectedNoteId: NoteId | null;
  onSelectNote: (id: NoteId | null) => void;
  onSelectTrack: () => void;
  onAddNote: (start: number) => void;
  onResizeNote: (noteId: NoteId, duration: number) => void;
  onMoveNote: (noteId: NoteId, start: number) => void;
  onLoadSample: (file: File) => void;
}

export function TrackRow({
  index,
  track,
  pattern,
  beatsPerBar,
  selected,
  selectedNoteId,
  onSelectNote,
  onSelectTrack,
  onAddNote,
  onResizeNote,
  onMoveNote,
  onLoadSample,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const beats = totalBeats(pattern, beatsPerBar);
  const notes = notesForTrack(pattern, track.id);
  const width = beats * BEAT_WIDTH_PX;

  return (
    <div className={`track-row ${selected ? "selected" : ""}`}>
      <div className="track-header" onClick={onSelectTrack}>
        <span className="track-num">{String(index + 1).padStart(2, "0")}</span>
        <span className={`track-name ${track.assetId == null ? "unassigned" : ""}`}>
          {track.assetId == null ? "— empty —" : track.name}
        </span>
        {track.fx.length > 0 && <span className="track-fx-badge">{track.fx.length}FX</span>}
        <button
          className="load-btn"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
        >
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
      <div className="track-lane" style={{ width }}>
        <div className="cells" style={{ gridTemplateColumns: `repeat(${beats}, ${BEAT_WIDTH_PX}px)` }}>
          {Array.from({ length: beats }, (_, i) => (
            <button
              key={i}
              className={`cell ${i % beatsPerBar === 0 ? "bar-start" : ""}`}
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
