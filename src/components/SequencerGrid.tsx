import { useCallback, useRef } from "react";
import type { FxTarget, NoteId, Pattern, Project, TrackId } from "../model/types";
import { totalBeats } from "../model/types";
import { usePlayheadAnimation } from "../hooks/usePlayheadAnimation";
import { useVisibleColumnWindow } from "../hooks/useVisibleColumnWindow";
import { useStableTrackNotes } from "../hooks/useStableTrackNotes";
import { TrackRow } from "./TrackRow";
import { MasterRow } from "./MasterRow";
import { COLUMN_OVERSCAN_BEATS, VIEWPORT_BARS } from "./timelineConstants";

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
  onLoadSample: (trackId: TrackId, file: File) => void;
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
}

/** The main sequencing surface for one pattern (the one currently selected in PatternBar).
 * The viewport shows up to VIEWPORT_BARS bars at fixed pixel width per beat (project brief
 * section 7) and scrolls horizontally for longer patterns, rather than stretching every beat
 * to fill available width — this is what makes "always show two bars" and "long patterns
 * scroll" both true using one ordinary DOM layout, no virtualization or canvas. */
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
  onLoadSample,
  loopingTrackIds,
  triggerDisabled,
  onTriggerTrack,
  getPlayheadBeat,
  pxPerBeat,
}: Props) {
  const beats = totalBeats(pattern, project.beatsPerBar);
  const contentWidth = beats * pxPerBeat;
  const viewportCap = VIEWPORT_BARS * project.beatsPerBar * pxPerBeat;
  const playheadRef = usePlayheadAnimation(getPlayheadBeat, pxPerBeat);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visibleColumns = useVisibleColumnWindow(
    scrollRef,
    pxPerBeat,
    beats,
    COLUMN_OVERSCAN_BEATS,
    VIEWPORT_BARS * project.beatsPerBar,
  );
  const trackNotes = useStableTrackNotes(pattern, project.tracks);
  const handleSelectMaster = useCallback(() => onSelectTarget("master"), [onSelectTarget]);

  return (
    <div className="sequencer" onClick={() => onSelectNote(null)}>
      <div
        className="timeline-scroll"
        ref={scrollRef}
        style={{ maxWidth: `calc(var(--header-width) + ${viewportCap}px)` }}
      >
        <div className="timeline-content">
          <div className="grid-header">
            <div className="track-col-label">Track / Sample</div>
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
            {project.tracks.map((track, i) => (
              <div key={track.id} onClick={(e) => e.stopPropagation()}>
                <TrackRow
                  index={i}
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
                  onLoadSample={onLoadSample}
                  looping={loopingTrackIds.includes(track.id)}
                  triggerDisabled={triggerDisabled}
                  onTrigger={onTriggerTrack}
                />
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
