import { memo } from "react";
import type { FxTarget, Note, NoteId, Track, TrackId } from "../model/types";
import { effectivePlaybackMode, trackHasSource } from "../model/types";
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
  onRemoveNote: (noteId: NoteId) => void;
  /** Same actions the Mixer strip uses; the state itself is the track's own muted/soloed, so the
   * two surfaces can't drift apart. */
  onSetMuted: (trackId: TrackId, muted: boolean) => void;
  onSetSoloed: (trackId: TrackId, soloed: boolean) => void;
  /** This track's manual loop is sounding (see audio/playback.ts). A primitive, so the memo still holds. */
  looping: boolean;
  /** Disables the trigger while a resample is armed or capturing. */
  triggerDisabled: boolean;
  onTrigger: (trackId: TrackId) => void;
}

function TrackRowImpl({
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
  onRemoveNote,
  onSetMuted,
  onSetSoloed,
  looping,
  triggerDisabled,
  onTrigger,
}: Props) {
  const loopTrack = effectivePlaybackMode(track) === "loop";
  const width = beats * pxPerBeat;
  // Defensive clamp: the visible window is recomputed on its own rAF cadence (see
  // useVisibleColumnWindow) and can lag a frame behind a `beats` change (e.g. switching to a
  // shorter pattern), so clamp rather than render cells past the end of this pattern.
  const start = Math.min(visibleStart, beats);
  const end = Math.min(visibleEnd, beats);

  return (
    <div className={`track-row ${selected ? "selected" : ""} ${track.muted ? "muted" : ""}`}>
      <div className="track-header" onClick={() => onSelectTarget(track.id)}>
        <span className="track-num">{String(index + 1).padStart(2, "0")}</span>
        <span className={`track-name ${trackHasSource(track) ? "" : "unassigned"}`}>
          {trackHasSource(track) ? track.name : "— empty —"}
        </span>
        {trackHasSource(track) && <span className="track-source-tag">{track.instrument ? "SYN" : "SMP"}</span>}
        {track.fx.length > 0 && <span className="track-fx-badge">{track.fx.length}FX</span>}
        {/* Phone: the M/S buttons are hidden (see index.css), but the STATE still shows — a muted or
            soloed track reads at a glance with no controls and no extra row. */}
        {track.muted && <span className="track-state-tag muted">M</span>}
        {track.soloed && <span className="track-state-tag soloed">S</span>}
        {selected && trackHasSource(track) && (
          // Only on the selected track, so the header stays uncluttered (ECS-83). Its click must
          // not reach the header's select handler.
          <button
            className={`track-trigger ${looping ? "active" : ""}`}
            disabled={triggerDisabled}
            title={triggerDisabled ? "Unavailable while resampling" : looping ? "Stop loop" : loopTrack ? "Start loop" : "Play"}
            aria-label={looping ? `Stop ${track.name} loop` : loopTrack ? `Start ${track.name} loop` : `Play ${track.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onTrigger(track.id);
            }}
          >
            {looping ? "■" : "▶"}
          </button>
        )}
        <button
          className={`track-mute ${track.muted ? "active" : ""}`}
          title="Mute"
          aria-label={`Mute ${track.name}`}
          aria-pressed={track.muted}
          onClick={(e) => {
            e.stopPropagation();
            onSetMuted(track.id, !track.muted);
          }}
        >
          M
        </button>
        <button
          className={`track-solo ${track.soloed ? "active" : ""}`}
          title="Solo"
          aria-label={`Solo ${track.name}`}
          aria-pressed={track.soloed}
          onClick={(e) => {
            e.stopPropagation();
            onSetSoloed(track.id, !track.soloed);
          }}
        >
          S
        </button>
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
            onRemove={() => onRemoveNote(note.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** Re-render only when something this row actually shows changed. `track` is a new object on every
 * edit to that track (volume and pan drags, instrument params, FX params...), none of which the
 * row displays, so comparing the displayed fields keeps a fader drag in the Track column from
 * re-rendering its row (and the memoised callbacks keep every other row quiet as before). */
function sameRow(a: Props, b: Props): boolean {
  const { track: ta, ...restA } = a;
  const { track: tb, ...restB } = b;
  const keys = Object.keys(restA) as (keyof typeof restA)[];
  for (const key of keys) {
    if (restA[key] !== restB[key]) return false;
  }
  return (
    ta === tb ||
    (ta.id === tb.id &&
      ta.name === tb.name &&
      ta.assetId === tb.assetId &&
      ta.instrument?.kind === tb.instrument?.kind &&
      ta.fx.length === tb.fx.length &&
      ta.muted === tb.muted &&
      ta.soloed === tb.soloed &&
      ta.playbackMode === tb.playbackMode)
  );
}

export const TrackRow = memo(TrackRowImpl, sameRow);
