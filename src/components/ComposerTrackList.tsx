import { memo, useMemo } from "react";
import { isTrackOffInPattern } from "../model/patternSettings";
import type { FxTarget, Pattern, Track, TrackId } from "../model/types";
import { trackHasSource } from "../model/types";

export interface ComposerTrackListProps {
  tracks: Track[];
  masterFxCount: number;
  /** The selected sequence's pattern: the notes counted and the "notes off" switch below are its. Undefined with no sequence selected. */
  pattern: Pattern | undefined;
  /** What `pattern` is called here (the sequence's name). */
  patternLabel: string;
  selectedTarget: FxTarget;
  onSelectTarget: (target: FxTarget) => void;
  onSetMuted: (trackId: TrackId, muted: boolean) => void;
  onSetSoloed: (trackId: TrackId, soloed: boolean) => void;
  onSetNotesOff: (trackId: TrackId, off: boolean) => void;
}

/** Notes per track in one pass over the pattern. */
function countNotes(pattern: Pattern | undefined): Map<TrackId, number> {
  const counts = new Map<TrackId, number>();
  if (!pattern) return counts;
  for (const note of Object.values(pattern.notes)) counts.set(note.trackId, (counts.get(note.trackId) ?? 0) + 1);
  return counts;
}

/** The Composer's track column: the sequencer's track headers without the note grid, under the timeline and its automation
 * lane. Clicking a track selects it (so the automation lane above follows it, as does the dock); mute / solo are the
 * track's own, the ♪ switch is the per-pattern "notes off". Each row says whether the track has notes in the selected
 * sequence, is empty there, or is switched off. The timeline above stays put while this list scrolls. No playhead here. */
export function ComposerTrackList({ tracks, masterFxCount, pattern, patternLabel, selectedTarget, onSelectTarget, onSetMuted, onSetSoloed, onSetNotesOff }: ComposerTrackListProps) {
  const counts = useMemo(() => countNotes(pattern), [pattern]);
  const patternId = pattern?.id ?? null;
  return (
    <div className="composer-tracks">
      <div className="composer-tracks-head">
        <span>Tracks</span>
        <span className="composer-tracks-pattern" title="The notes shown below are those of the selected sequence's pattern">
          {pattern ? patternLabel : "select a sequence to see its notes"}
        </span>
      </div>
      <div className="composer-tracks-scroll">
        <div className={`composer-track master ${selectedTarget === "master" ? "selected" : ""}`} onClick={() => onSelectTarget("master")}>
          <span className="composer-track-num" />
          <span className="composer-track-name master-name">MASTER</span>
          {masterFxCount > 0 && <span className="track-fx-badge">{masterFxCount}FX</span>}
        </div>
        {tracks.map((track, i) => (
          <ComposerTrackRow
            key={track.id}
            track={track}
            index={i}
            selected={selectedTarget === track.id}
            hasPattern={patternId !== null}
            noteCount={counts.get(track.id) ?? 0}
            notesOff={isTrackOffInPattern(pattern, track.id)}
            onSelectTarget={onSelectTarget}
            onSetMuted={onSetMuted}
            onSetSoloed={onSetSoloed}
            onSetNotesOff={onSetNotesOff}
          />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  track: Track;
  index: number;
  selected: boolean;
  hasPattern: boolean;
  noteCount: number;
  notesOff: boolean;
  onSelectTarget: (target: FxTarget) => void;
  onSetMuted: (trackId: TrackId, muted: boolean) => void;
  onSetSoloed: (trackId: TrackId, soloed: boolean) => void;
  onSetNotesOff: (trackId: TrackId, off: boolean) => void;
}

/** What the row says about the track in the selected sequence: its notes, none, or switched off (own mute or pattern notes-off). */
function trackState(muted: boolean, notesOff: boolean, noteCount: number): { kind: "off" | "notes" | "empty"; text: string } {
  if (muted) return { kind: "off", text: "muted" };
  if (notesOff) return { kind: "off", text: "off" };
  return noteCount > 0 ? { kind: "notes", text: String(noteCount) } : { kind: "empty", text: "empty" };
}

const ComposerTrackRow = memo(function ComposerTrackRow({ track, index, selected, hasPattern, noteCount, notesOff, onSelectTarget, onSetMuted, onSetSoloed, onSetNotesOff }: RowProps) {
  const state = trackState(track.muted, notesOff, noteCount);
  return (
    <div className={`composer-track ${selected ? "selected" : ""} ${state.kind === "off" ? "disabled" : ""}`} onClick={() => onSelectTarget(track.id)}>
      <span className="composer-track-num">{String(index + 1).padStart(2, "0")}</span>
      <span className={`composer-track-name ${trackHasSource(track) ? "" : "unassigned"}`}>{trackHasSource(track) ? track.name : "— empty —"}</span>
      {trackHasSource(track) && <span className="track-source-tag">{track.instrument ? "SYN" : "SMP"}</span>}
      {track.fx.length > 0 && <span className="track-fx-badge">{track.fx.length}FX</span>}
      {hasPattern && (
        <span className={`composer-track-state ${state.kind}`} title={state.kind === "notes" ? `${noteCount} note${noteCount === 1 ? "" : "s"} in this sequence` : state.kind === "empty" ? "No notes in this sequence" : "Not playing in this sequence"}>
          {state.text}
        </span>
      )}
      <button
        className={`composer-track-btn notes ${notesOff ? "active" : ""}`}
        disabled={!hasPattern}
        title={notesOff ? "Notes off in this sequence's pattern — click to play them" : "Switch this track's notes off in this sequence's pattern"}
        aria-label={`${track.name} notes in this pattern`}
        aria-pressed={!notesOff}
        onClick={(e) => {
          e.stopPropagation();
          onSetNotesOff(track.id, !notesOff);
        }}
      >
        ♪
      </button>
      <button
        className={`composer-track-btn mute ${track.muted ? "active" : ""}`}
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
        className={`composer-track-btn solo ${track.soloed ? "active" : ""}`}
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
  );
});
