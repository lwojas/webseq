import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { canPlace, composerLanes, describeModifiers, laneModifiers, maxSequenceBars, sequenceBars, sequenceName, timelineEnd } from "../model/composer";
import type { AutomationLane as AutomationLaneModel, LaneId, Project, SequenceId } from "../model/types";
import { usePlayheadAnimation } from "../hooks/usePlayheadAnimation";
import { AutomationLane } from "./AutomationLane";
import type { AutomationRowProps } from "./AutomationRow";
import { ComposerTrackList, type ComposerTrackListProps } from "./ComposerTrackList";
import { RafText } from "./RafText";

/** Pixels per bar at 100% zoom. */
export const COMPOSER_BAR_PX = 96;
/** Empty space kept inside the timeline before bar 1 and after the last bar: the canvas has its own inset, so
 * the first sequence never touches the lane header or the edge, and there is always room to drop one at the end. */
export const COMPOSER_INSET_PX = 24;
/** Width of the lane header column (also `--header-width` inside .composer, so the automation row lines up). */
export const COMPOSER_HEADER_PX = 168;
/** Empty bars kept past the last sequence. */
const TAIL_BARS = 4;
const MIN_BARS = 16;
const CLICK_VS_DRAG_PX = 4;
/** Discrete zoom levels, as a percentage of COMPOSER_BAR_PX (100 = the default view). */
const ZOOM_PERCENTS = [25, 50, 100, 125, 150] as const;
const DEFAULT_ZOOM_INDEX = ZOOM_PERCENTS.indexOf(100);
const ZOOM_STORAGE_KEY = "webseq.composerZoomIndex";

function loadZoomIndex(): number {
  try {
    const stored = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
    if (Number.isInteger(stored) && stored >= 0 && stored < ZOOM_PERCENTS.length) return stored;
  } catch {
    // storage unavailable: fall back to the default
  }
  return DEFAULT_ZOOM_INDEX;
}

interface Drag {
  id: SequenceId;
  mode: "move" | "resize";
  laneId: LaneId;
  start: number;
  bars: number;
  valid: boolean;
}

/** The arranging actions. The Edit panel's Composer groups show them as buttons; the timeline itself uses only Edit Sequence and Play from
 * here (its toolbar) and Edit / Delete (keyboard on a selected block). */
export interface ComposerToolbarProps {
  hasSelection: boolean;
  hasMarker: boolean;
  /** New sequence / Paste insert at the marker; off when it would not fit there. */
  canNewSequence: boolean;
  blockedReason: string;
  canPaste: boolean;
  onNewSequence: () => void;
  onAddLane: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onPlayFromHere: () => void;
}

interface Props {
  project: Project;
  /** Where the viewport's horizontal scroll is remembered. The view is unmounted while the Sequencer shows (it takes
   * the grid's place), so the owner keeps this across the trip and the view restores it. */
  scrollMemory: MutableRefObject<number>;
  /** Song mode: the playhead's beat from the start of the song, or null (hidden) when not playing the song. */
  getSongBeat: () => number | null;
  /** The sequences sounding now (Song mode), one per lane at most. */
  playingSequenceIds: ReadonlySet<SequenceId>;
  /** "Verse + Verse · bar 3 · change in 1.5 bars", read per frame (see RafText). */
  getSongText: () => string;
  /** The marker: a bar boundary, or null. Click the ruler to set it (click it again to clear it). */
  marker: number | null;
  onSetMarker: (bar: number | null) => void;
  selectedSequenceId: SequenceId | null;
  selectedLaneId: LaneId | null;
  onSelectSequence: (id: SequenceId) => void;
  onSelectLane: (id: LaneId | null) => void;
  onMove: (id: SequenceId, start: number, laneId: LaneId) => void;
  onResize: (id: SequenceId, bars: number) => void;
  onRenameLane: (id: LaneId, name: string) => void;
  onMoveLane: (id: LaneId, index: number) => void;
  onRemoveLane: (id: LaneId) => void;
  /** The existing automation lane in focus (the one the Sequencer's grid shows for the selected track or master), and where
   * it plays in the song. It is drawn over each of those sequences with that sequence's pattern's own lane, and editing a
   * point edits that pattern's lane only. Nothing here is Composer data. */
  automation: {
    row: AutomationRowProps | null;
    /** Each sequence the lane plays over, with the lane ITS pattern plays (patterns have their own) and the edit handlers for it. */
    spans: { startBeat: number; beats: number; patternId: string; lane: AutomationLaneModel | undefined }[];
    onSetPoint: (patternId: string, position: number, value: number) => void;
    onRemovePoint: (patternId: string, position: number) => void;
  };
  toolbar: ComposerToolbarProps;
  /** The track column under the timeline: select a track (the automation lane follows it), mute, solo, notes off. */
  trackList: ComposerTrackListProps;
}

/** The Composer: the song as lanes of sequence blocks on one shared timeline, with the tracks listed under it. The timeline is
 * ONE scrolling viewport — ruler, lane headers, blocks and automation all move together — and it owns horizontal navigation: a sideways trackpad swipe
 * scrolls the timeline and does not fall through to the browser's back/forward gesture. A click selects, dragging a
 * block moves it (along its lane, or onto another lane), dragging its right edge resizes it; a drop that would overlap
 * on the lane shows red and is discarded (nothing is ever pushed aside). Pointer events, so it works by touch. */
export function ComposerTimeline({
  project,
  scrollMemory,
  getSongBeat,
  playingSequenceIds,
  getSongText,
  marker,
  onSetMarker,
  selectedSequenceId,
  selectedLaneId,
  onSelectSequence,
  onSelectLane,
  onMove,
  onResize,
  onRenameLane,
  onMoveLane,
  onRemoveLane,
  automation,
  toolbar,
  trackList,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const lanes = composerLanes(project);
  const bpb = project.beatsPerBar;
  const [zoomIndex, setZoomIndex] = useState(loadZoomIndex);
  const zoomPercent = ZOOM_PERCENTS[zoomIndex];
  const barPx = (COMPOSER_BAR_PX * zoomPercent) / 100;
  const totalBars = Math.max(MIN_BARS, timelineEnd(project) + TAIL_BARS);
  const prevBarPx = useRef(barPx);
  const trackWidth = COMPOSER_INSET_PX * 2 + totalBars * barPx;
  const playheadRef = usePlayheadAnimation(getSongBeat, barPx / bpb, true);
  const selectedSeq = selectedSequenceId ? lanes.flatMap((l) => l.sequences).find((s) => s.id === selectedSequenceId) : undefined;

  // Horizontal navigation belongs to the timeline. A mostly-sideways wheel/trackpad gesture is consumed here (so the
  // browser never reads it as back/forward) and moves the whole viewport; a mostly-vertical one is left alone and
  // scrolls the lanes as usual. Needs a non-passive native listener: React's onWheel cannot preventDefault.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaX;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Remember the zoom, and keep the bar at the centre of the view under the centre when it changes.
  useLayoutEffect(() => {
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(zoomIndex));
    } catch {
      // not persisted; still works for this session
    }
    const el = viewportRef.current;
    const oldPx = prevBarPx.current;
    prevBarPx.current = barPx;
    if (!el || oldPx === barPx) return;
    const half = (el.clientWidth - COMPOSER_HEADER_PX) / 2;
    const centreBar = (el.scrollLeft + half - COMPOSER_INSET_PX) / oldPx;
    el.scrollLeft = Math.max(0, COMPOSER_INSET_PX + centreBar * barPx - half);
  }, [zoomIndex, barPx]);

  // Back from the sequencer: restore the scroll, then bring the selection into view only if it is off screen.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollLeft = scrollMemory.current;
    revealSelection(el, barPx, selectedSeq?.start, selectedSeq && sequenceBars(project, selectedSeq));
    // Only when the view appears — not on every project edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Keep the selection in view when it changes while here (e.g. a duplicate lands off screen).
  useEffect(() => {
    const el = viewportRef.current;
    if (el) revealSelection(el, barPx, selectedSeq?.start, selectedSeq && sequenceBars(project, selectedSeq));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSequenceId]);

  const beginDrag = (e: React.PointerEvent, id: SequenceId, laneId: LaneId, mode: Drag["mode"]) => {
    e.stopPropagation();
    const lane = lanes.find((l) => l.id === laneId);
    const seq = lane?.sequences.find((s) => s.id === id);
    if (!seq) return;
    onSelectSequence(id);
    const startX = e.clientX;
    const bars0 = sequenceBars(project, seq);
    const maxBars = maxSequenceBars(project, seq);
    let moved = false;
    let current: Drag = { id, mode, laneId, start: seq.start, bars: bars0, valid: true };
    const onMoveEvt = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > CLICK_VS_DRAG_PX) moved = true;
      if (!moved) return;
      const delta = Math.round((ev.clientX - startX) / barPx);
      if (mode === "move") {
        const under = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-lane-id]")?.dataset.laneId;
        const target = under ?? current.laneId;
        const start = Math.max(0, seq.start + delta);
        current = { id, mode, laneId: target, start, bars: bars0, valid: canPlace(project, target, start, bars0, id) };
      } else {
        const bars = Math.max(1, bars0 + delta);
        current = { id, mode, laneId, start: seq.start, bars, valid: bars <= maxBars };
      }
      setDrag(current);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMoveEvt);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDrag(null);
      if (!moved || !current.valid) return;
      if (mode === "move" && (current.start !== seq.start || current.laneId !== laneId)) onMove(id, current.start, current.laneId);
      if (mode === "resize" && current.bars !== bars0) onResize(id, current.bars);
    };
    window.addEventListener("pointermove", onMoveEvt);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const left = (bar: number) => COMPOSER_INSET_PX + bar * barPx;
  const gridStyle = { width: trackWidth, backgroundSize: `${barPx}px 100%`, backgroundPosition: `${COMPOSER_INSET_PX}px 0` };

  return (
    <div className="composer">
      <ComposerToolbar
        {...toolbar}
        getSongText={getSongText}
        zoomPercent={zoomPercent}
        canZoomIn={zoomIndex < ZOOM_PERCENTS.length - 1}
        canZoomOut={zoomIndex > 0}
        onZoomIn={() => setZoomIndex((i) => Math.min(ZOOM_PERCENTS.length - 1, i + 1))}
        onZoomOut={() => setZoomIndex((i) => Math.max(0, i - 1))}
      />
      <div className="composer-viewport" ref={viewportRef} onScroll={(e) => (scrollMemory.current = e.currentTarget.scrollLeft)}>
        <div className="composer-canvas" style={{ width: COMPOSER_HEADER_PX + trackWidth }}>
          <div className="composer-ruler">
            <div className="composer-corner">Lanes</div>
            <div
              className="composer-ruler-marks"
              style={{ width: trackWidth }}
              title="Click to put the marker on the nearest bar line (click it again to clear)"
              onPointerDown={(e) => {
                const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
                const bar = Math.max(0, Math.round((x - COMPOSER_INSET_PX) / barPx));
                onSetMarker(bar === marker ? null : bar);
              }}
            >
              {marker !== null && <span className="composer-marker-flag" style={{ left: left(marker) }} />}
              {Array.from({ length: totalBars }, (_, bar) => (
                <span key={bar} className="composer-bar-mark" style={{ left: left(bar) }}>
                  {bar + 1}
                </span>
              ))}
            </div>
          </div>

          {lanes.map((lane, index) => {
            const laneSelected = lane.id === selectedLaneId;
            const modifiers = describeModifiers(laneModifiers(lane));
            return (
              <Fragment key={lane.id}>
                <div className={`composer-lane ${laneSelected ? "selected" : ""}`} data-lane-id={lane.id}>
                  <div className="composer-lane-header" onPointerDown={() => onSelectLane(lane.id)}>
                    <input
                      className="composer-lane-name"
                      value={lane.name}
                      aria-label="Lane name"
                      onChange={(e) => onRenameLane(lane.id, e.target.value)}
                    />
                    <div className="composer-lane-controls">
                      <button className="composer-lane-btn" disabled={index === 0} aria-label="Move lane up" onClick={() => onMoveLane(lane.id, index - 1)}>
                        ▲
                      </button>
                      <button className="composer-lane-btn" disabled={index === lanes.length - 1} aria-label="Move lane down" onClick={() => onMoveLane(lane.id, index + 1)}>
                        ▼
                      </button>
                      <button
                        className="composer-lane-btn danger"
                        aria-label="Delete lane"
                        title="Delete this lane and its sequences"
                        onClick={() => (lane.sequences.length === 0 || window.confirm(`Delete "${lane.name}" and its ${lane.sequences.length} sequence(s)?`)) && onRemoveLane(lane.id)}
                      >
                        ×
                      </button>
                    </div>
                    <span className="composer-lane-meta" title="Musical modifiers applied to this lane's notes (set in the Edit panel)">
                      {modifiers || "no modifiers"}
                    </span>
                  </div>
                  <div className="composer-lane-track" style={gridStyle} onPointerDown={() => onSelectLane(lane.id)}>
                    {lane.sequences.map((seq) => {
                      const dragged = drag?.id === seq.id ? drag : null;
                      const bars = sequenceBars(project, seq);
                      return (
                        <div
                          key={seq.id}
                          className={`composer-seq ${seq.id === selectedSequenceId ? "selected" : ""} ${playingSequenceIds.has(seq.id) ? "playing" : ""} ${dragged?.mode === "move" ? "dragging" : ""}`}
                          style={{ left: left(seq.start), width: (dragged?.mode === "resize" ? dragged.bars : bars) * barPx - 2, background: seq.color }}
                          role="button"
                          tabIndex={0}
                          aria-pressed={seq.id === selectedSequenceId}
                          title={`${sequenceName(project, seq)} — bar ${seq.start + 1}, ${bars} bar${bars === 1 ? "" : "s"}`}
                          onPointerDown={(e) => beginDrag(e, seq.id, lane.id, "move")}
                          onFocus={() => onSelectSequence(seq.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") toolbar.onEdit();
                            else if (e.key === "Delete" || e.key === "Backspace") toolbar.onDelete();
                          }}
                        >
                          <span className="composer-seq-name">{sequenceName(project, seq)}</span>
                          <span className="composer-seq-handle" aria-hidden="true" onPointerDown={(e) => beginDrag(e, seq.id, lane.id, "resize")} />
                        </div>
                      );
                    })}
                    {drag?.mode === "move" && drag.laneId === lane.id && (
                      <div
                        className={`composer-seq ghost ${drag.valid ? "" : "invalid"}`}
                        style={{ left: left(drag.start), width: drag.bars * barPx - 2 }}
                      />
                    )}
                  </div>
                </div>
              </Fragment>
            );
          })}
          {lanes.length > 0 && (
            <div className="composer-lane composer-lane-auto">
              <div className="composer-lane-header">
                {automation.row ? (
                  <>
                    <span className="composer-auto-label" title={`${automation.row.label} automation`}>
                      <span className="automation-row-kind">Auto</span> {automation.row.label}
                    </span>
                    <button className="composer-lane-btn" aria-label="Hide automation lane" title="Hide the lane (the automation keeps playing)" onClick={automation.row.onClose}>
                      ×
                    </button>
                  </>
                ) : (
                  <span className="composer-auto-label">Automation</span>
                )}
              </div>
              <div className="composer-lane-track composer-auto-track" style={{ width: trackWidth }}>
                {automation.row && automation.spans.length > 0 ? (
                  automation.spans.map((span) => (
                    <div key={`${span.startBeat}-${span.patternId}`} className="composer-auto-lane" style={{ left: left(span.startBeat / bpb) }}>
                      <AutomationLane
                        lane={span.lane}
                        paramDef={automation.row!.paramDef}
                        totalBeats={span.beats}
                        beatsPerBar={bpb}
                        pxPerBeat={barPx / bpb}
                        onSetPoint={(position, value) => automation.onSetPoint(span.patternId, position, value)}
                        onRemovePoint={(position) => automation.onRemovePoint(span.patternId, position)}
                      />
                    </div>
                  ))
                ) : (
                  <span className="composer-auto-hint">
                    {automation.row ? "The selected track has no notes in these sequences." : "Open a parameter's Automation (Instrument or FX panel below) to edit it here, over the sequences it plays in."}
                  </span>
                )}
              </div>
            </div>
          )}
          {lanes.length === 0 && <div className="composer-empty">Add a sequence or a lane to start composing the song.</div>}
          {marker !== null && <div className="composer-marker" style={{ left: COMPOSER_HEADER_PX + left(marker) }} />}
          <div className="composer-playhead-layer" style={{ left: COMPOSER_HEADER_PX + COMPOSER_INSET_PX }}>
            <div className="composer-playhead" ref={playheadRef} />
          </div>
        </div>
      </div>
      <ComposerTrackList {...trackList} />
    </div>
  );
}

/** Scrolls `el` just enough to show bars [start, start + bars) if they are off screen. The lane headers are sticky at the
 * left, so the visible part of the timeline is the viewport minus that column. */
function revealSelection(el: HTMLElement, barPx: number, start: number | undefined, bars: number | undefined): void {
  if (start === undefined || bars === undefined) return;
  const from = COMPOSER_INSET_PX + start * barPx; // within the lane track
  const to = from + bars * barPx;
  const visibleFrom = el.scrollLeft; // track coordinates: the track's own origin sits right of the sticky header
  const visibleTo = el.scrollLeft + el.clientWidth - COMPOSER_HEADER_PX;
  if (from < visibleFrom || to > visibleTo) el.scrollLeft = Math.max(0, from - COMPOSER_INSET_PX);
}

function ComposerToolbar(
  p: ComposerToolbarProps & { getSongText: () => string; zoomPercent: number; canZoomIn: boolean; canZoomOut: boolean; onZoomIn: () => void; onZoomOut: () => void },
) {
  const needs = p.hasSelection ? undefined : "Select a sequence first";
  return (
    <div className="composer-toolbar">
      <span className="composer-status-label">Song</span>
      <RafText className="composer-status-text" getText={p.getSongText} />
      <span className="composer-toolbar-spacer" />
      <div className="field zoom-control">
        <span>Zoom</span>
        <button className="btn small" onClick={p.onZoomOut} disabled={!p.canZoomOut} aria-label="Zoom out" title="Zoom out">
          −
        </button>
        <span className="zoom-level">{p.zoomPercent}%</span>
        <button className="btn small" onClick={p.onZoomIn} disabled={!p.canZoomIn} aria-label="Zoom in" title="Zoom in">
          +
        </button>
      </div>
      <button className="btn small view-switch-btn" disabled={!p.hasSelection} title={needs ?? "Open this sequence in the sequencer"} onClick={p.onEdit}>
        Edit Sequence ▸
      </button>
      <button className="btn small" disabled={!p.hasSelection && !p.hasMarker} title={p.hasMarker ? "Play the song from the marker" : needs ?? "Play the song from the start of this sequence (set a marker to start anywhere)"} onClick={p.onPlayFromHere}>
        ▶ From here
      </button>
    </div>
  );
}
