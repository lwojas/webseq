import { memo, useRef } from "react";
import type { FxTarget, Note, NoteId, Track, TrackId } from "../model/types";
import { NoteBlock } from "./NoteBlock";

interface Props {
  index: number;
  track: Track;
  /** This track's notes only (see useStableTrackNotes) — never the whole Pattern, so that an
   * edit to another track's note doesn't change this row's props and defeat the memo below. */
  notes: Note[];
  /** Total beats in the pattern (pattern.bars * beatsPerBar) — same for every row, passed down
   * already computed so each row doesn't need the whole Pattern just to derive one number. */
  beats: number;
  beatsPerBar: number;
  pxPerBeat: number;
  /** Beat-index range (inclusive start, exclusive end) of step cells to actually mount — see
   * useVisibleColumnWindow. Cells outside this range exist conceptually (the grid-template
   * still reserves their column) but have no DOM node. */
  visibleStart: number;
  visibleEnd: number;
  selected: boolean;
  selectedNoteId: NoteId | null;
  onSelectNote: (id: NoteId | null) => void;
  onSelectTarget: (target: FxTarget) => void;
  onAddNote: (trackId: TrackId, start: number) => void;
  onResizeNote: (noteId: NoteId, duration: number, freePlacement: boolean) => void;
  onMoveNote: (noteId: NoteId, start: number, freePlacement: boolean) => void;
  onLoadSample: (trackId: TrackId, file: File) => void;
}

export const TrackRow = memo(function TrackRow({
  index,
  track,
  notes,
  beats,
  beatsPerBar,
  pxPerBeat,
  visibleStart,
  visibleEnd,
  selected,
  selectedNoteId,
  onSelectNote,
  onSelectTarget,
  onAddNote,
  onResizeNote,
  onMoveNote,
  onLoadSample,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const width = beats * pxPerBeat;
  // Defensive clamp: the visible window is recomputed on its own rAF cadence (see
  // useVisibleColumnWindow) and can lag a frame behind a `beats` change (e.g. switching to a
  // shorter pattern), so clamp rather than render cells past the end of this pattern.
  const start = Math.min(visibleStart, beats);
  const end = Math.min(visibleEnd, beats);

  return (
    <div className={`track-row ${selected ? "selected" : ""}`}>
      <div className="track-header" onClick={() => onSelectTarget(track.id)}>
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
            if (file) onLoadSample(track.id, file);
            e.target.value = "";
          }}
        />
      </div>
      <div className="track-lane" style={{ width }}>
        <div className="cells" style={{ gridTemplateColumns: `repeat(${beats}, ${pxPerBeat}px)` }}>
          {Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
            const i = start + offset;
            return (
              <button
                key={i}
                className={`cell ${i % beatsPerBar === 0 ? "bar-start" : ""}`}
                style={{ gridColumn: i + 1 }}
                onClick={() => onAddNote(track.id, i)}
                aria-label={`beat ${i + 1}`}
              />
            );
          })}
        </div>
        {notes.map((note) => (
          <NoteBlock
            key={note.id}
            note={note}
            totalBeats={beats}
            selected={note.id === selectedNoteId}
            onSelect={() => onSelectNote(note.id)}
            onResize={(duration, freePlacement) => onResizeNote(note.id, duration, freePlacement)}
            onMove={(start, freePlacement) => onMoveNote(note.id, start, freePlacement)}
          />
        ))}
      </div>
    </div>
  );
});
