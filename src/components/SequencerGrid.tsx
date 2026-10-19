import { useCallback, useRef, type CSSProperties } from "react";
import type { FxTarget, NoteId, Pattern, Project, TrackId } from "../model/types";
import { totalBeats } from "../model/types";
import { BANK_SIZE, tracksInBank, type BankSummary } from "../model/project";
import { usePlayheadAnimation } from "../hooks/usePlayheadAnimation";
import { useVisibleColumnWindow } from "../hooks/useVisibleColumnWindow";
import { useStableTrackNotes } from "../hooks/useStableTrackNotes";
import { TrackRow } from "./TrackRow";
import { MasterRow } from "./MasterRow";
import { AutomationRow, type AutomationRowProps } from "./AutomationRow";
import { BankBar } from "./BankBar";
import { COLUMN_OVERSCAN_BEATS, INITIAL_VISIBLE_BEATS } from "./timelineConstants";

interface Props {
  project: Project;
  pattern: Pattern;
  selectedTarget: FxTarget;
  onSelectTarget: (target: FxTarget) => void;
  selectedNoteId: NoteId | null;
  onSelectNote: (id: NoteId | null) => void;
  onAddNote: (trackId: TrackId, start: number) => void;
  onResizeNote: (noteId: NoteId, duration: number, freePlacement: boolean) => void;
  onMoveNote: (noteId: NoteId, start: number, freePlacement: boolean) => void;
  onRemoveNote: (noteId: NoteId) => void;
  onSetMuted: (trackId: TrackId, muted: boolean) => void;
  onSetSoloed: (trackId: TrackId, soloed: boolean) => void;
  /** Which bank of 16 tracks is shown (see model/project.ts's BANK_SIZE). */
  bank: number;
  bankSummaries: BankSummary[];
  onSelectBank: (bank: number) => void;
  /** Tracks whose manual loop is sounding (see audio/playback.ts). */
  loopingTrackIds: TrackId[];
  /** True while a resample is armed or capturing — the selected track's trigger is disabled then. */
  triggerDisabled: boolean;
  onTriggerTrack: (trackId: TrackId) => void;
  /** Beat position within `pattern`, or null if `pattern` isn't the one currently sounding —
   * see Transport.getPlayheadInfo() and usePlayheadAnimation's doc comment. */
  getPlayheadBeat: () => number | null;
  /** Current timeline zoom level, in pixels per beat — see useTimelineZoom and
   * timelineConstants.ts's ZOOM_LEVELS_PX_PER_BEAT doc comment (ECS-53). */
  pxPerBeat: number;
  /** False while the timeline is not on screen (pattern picker / settings open, another tab or the
   * Patterns view showing): the playhead and visible-column loops stop instead of running against a
   * hidden grid. */
  active: boolean;
  /** The focused automation lane, drawn as a row directly under the selected track (or MASTER). It
   * sits inside this scroll area at the same pxPerBeat, so it stays aligned with the notes above
   * it and scrolls and zooms with them. Null = none. */
  automationRow?: AutomationRowProps | null;
  /** Where the bank tabs go: "corner" of the grid header (desktop) or their own "row" (phone). */
  bankPlacement: "corner" | "row";
}

/** The main sequencing surface for one pattern (the one open in the pattern strip). Beats have a
 * fixed pixel width (the zoom level) and the grid fills whatever width it is given, scrolling
 * horizontally for longer patterns and showing an explicit "end of pattern" zone for shorter ones —
 * so a wide screen shows more of the pattern instead of capping the view to a fixed number of
 * bars. One ordinary DOM layout with only the visible step cells mounted; no canvas. */
export function SequencerGrid({
  project,
  pattern,
  selectedTarget,
  onSelectTarget,
  selectedNoteId,
  onSelectNote,
  onAddNote,
  onResizeNote,
  onMoveNote,
  onRemoveNote,
  onSetMuted,
  onSetSoloed,
  bank,
  bankSummaries,
  onSelectBank,
  loopingTrackIds,
  triggerDisabled,
  onTriggerTrack,
  getPlayheadBeat,
  pxPerBeat,
  active,
  bankPlacement,
  automationRow,
}: Props) {
  const beats = totalBeats(pattern, project.beatsPerBar);
  const contentWidth = beats * pxPerBeat;
  const playheadRef = usePlayheadAnimation(getPlayheadBeat, pxPerBeat, active);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visibleColumns = useVisibleColumnWindow(
    scrollRef,
    pxPerBeat,
    beats,
    COLUMN_OVERSCAN_BEATS,
    INITIAL_VISIBLE_BEATS,
    active,
  );
  const trackNotes = useStableTrackNotes(pattern, project.tracks);
  const laneRow = automationRow ? (
    <AutomationRow
      {...automationRow}
      totalBeats={beats}
      beatsPerBar={project.beatsPerBar}
      pxPerBeat={pxPerBeat}
      visibleStart={visibleColumns.start}
      visibleEnd={visibleColumns.end}
    />
  ) : null;
  const handleSelectMaster = useCallback(() => onSelectTarget("master"), [onSelectTarget]);

  return (
    <div className="sequencer" onClick={() => onSelectNote(null)}>
      {bankPlacement === "row" && <BankBar activeBank={bank} summaries={bankSummaries} onSelect={onSelectBank} />}
      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-content" style={{ "--content-width": `${contentWidth}px` } as CSSProperties}>
          <div className="grid-header">
            {bankPlacement === "corner" ? (
              <div className="track-col-label track-col-banks">
                <BankBar variant="corner" activeBank={bank} summaries={bankSummaries} onSelect={onSelectBank} />
              </div>
            ) : (
              <div className="track-col-label">Track</div>
            )}
            <div className="beat-ruler" style={{ width: contentWidth, gridTemplateColumns: `repeat(${beats}, ${pxPerBeat}px)` }}>
              {Array.from({ length: beats }, (_, i) => (
                <div key={i} className={`beat-num ${i % project.beatsPerBar === 0 ? "bar-start" : ""}`}>
                  {i + 1}
                </div>
              ))}
            </div>
          </div>
          <div className="track-rows">
            <div onClick={(e) => e.stopPropagation()}>
              <MasterRow
                width={contentWidth}
                selected={selectedTarget === "master"}
                fxCount={project.master.fx.length}
                onSelect={handleSelectMaster}
              />
            </div>
            {selectedTarget === "master" && laneRow}
            {tracksInBank(project, bank).map((track, i) => (
              <div key={track.id} onClick={(e) => e.stopPropagation()}>
                <TrackRow
                  index={bank * BANK_SIZE + i}
                  track={track}
                  notes={trackNotes.get(track.id) ?? []}
                  beats={beats}
                  beatsPerBar={project.beatsPerBar}
                  pxPerBeat={pxPerBeat}
                  visibleStart={visibleColumns.start}
                  visibleEnd={visibleColumns.end}
                  selected={selectedTarget === track.id}
                  selectedNoteId={selectedNoteId}
                  onSelectNote={onSelectNote}
                  onSelectTarget={onSelectTarget}
                  onAddNote={onAddNote}
                  onResizeNote={onResizeNote}
                  onMoveNote={onMoveNote}
                  onRemoveNote={onRemoveNote}
                  onSetMuted={onSetMuted}
                  onSetSoloed={onSetSoloed}
                  looping={loopingTrackIds.includes(track.id)}
                  triggerDisabled={triggerDisabled}
                  onTrigger={onTriggerTrack}
                />
                {selectedTarget === track.id && laneRow}
              </div>
            ))}
            <div className="playhead-wrapper" style={{ width: contentWidth }}>
              <div className="playhead" ref={playheadRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
