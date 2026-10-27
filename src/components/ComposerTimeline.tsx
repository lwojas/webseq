import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { canPlace, composerLanes, describeModifiers, laneModifiers, maxSequenceBars, sequenceBars, sequenceName, timelineEnd } from "../model/composer";
import type { LaneId, Project, SequenceId } from "../model/types";
import { usePlayheadAnimation } from "../hooks/usePlayheadAnimation";
import { AutomationLane } from "./AutomationLane";
import type { AutomationRowProps } from "./AutomationRow";
import { RafText } from "./RafText";

/** Pixels per bar. Fixed: the timeline is a compact overview, not a zoomable editor. */
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

interface Drag {
  id: SequenceId;
  mode: "move" | "resize";
  laneId: LaneId;
  start: number;
  bars: number;
  valid: boolean;
}

/** The few actions arranging needs, always at hand. Everything finer (name, length, colour, lane tracks, adding a
 * launcher pattern) is in the Edit panel's Composer group, not here. */
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
   * it plays in the song. It is drawn over each of those sequences; editing a point edits that one lane, so the Sequencer
   * shows the same change. Nothing here is Composer data. */
  automation: { row: AutomationRowProps | null; spans: { startBeat: number; beats: number }[] };
  toolbar: ComposerToolbarProps;
}

/** The Composer: the song as lanes of sequence blocks on one shared timeline. It is ONE scrolling viewport — ruler, lane
 * headers, blocks and automation all move together — and it owns horizontal navigation: a sideways trackpad swipe
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
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const lanes = composerLanes(project);
  const bpb = project.beatsPerBar;
  const totalBars = Math.max(MIN_BARS, timelineEnd(project) + TAIL_BARS);
  const trackWidth = COMPOSER_INSET_PX * 2 + totalBars * COMPOSER_BAR_PX;
  const playheadRef = usePlayheadAnimation(getSongBeat, COMPOSER_BAR_PX / bpb, true);
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

  // Back from the sequencer: restore the scroll, then bring the selection into view only if it is off screen.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollLeft = scrollMemory.current;
    revealSelection(el, selectedSeq?.start, selectedSeq && sequenceBars(project, selectedSeq));
    // Only when the view appears — not on every project edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Keep the selection in view when it changes while here (e.g. a duplicate lands off screen).
  useEffect(() => {
    const el = viewportRef.current;
    if (el) revealSelection(el, selectedSeq?.start, selectedSeq && sequenceBars(project, selectedSeq));
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
      const delta = Math.round((ev.clientX - startX) / COMPOSER_BAR_PX);
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

  const left = (bar: number) => COMPOSER_INSET_PX + bar * COMPOSER_BAR_PX;
  const gridStyle = { width: trackWidth, backgroundSize: `${COMPOSER_BAR_PX}px 100%`, backgroundPosition: `${COMPOSER_INSET_PX}px 0` };

  return (
    <div className="composer">
      <ComposerToolbar {...toolbar} getSongText={getSongText} />
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
                const bar = Math.max(0, Math.round((x - COMPOSER_INSET_PX) / COMPOSER_BAR_PX));
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
                          style={{ left: left(seq.start), width: (dragged?.mode === "resize" ? dragged.bars : bars) * COMPOSER_BAR_PX - 2, background: seq.color }}
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
                        style={{ left: left(drag.start), width: drag.bars * COMPOSER_BAR_PX - 2 }}
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
                    <div key={span.startBeat} className="composer-auto-lane" style={{ left: left(span.startBeat / bpb) }}>
                      <AutomationLane
                        lane={automation.row!.lane}
                        paramDef={automation.row!.paramDef}
                        totalBeats={span.beats}
                        beatsPerBar={bpb}
                        pxPerBeat={COMPOSER_BAR_PX / bpb}
                        onSetPoint={automation.row!.onSetPoint}
                        onRemovePoint={automation.row!.onRemovePoint}
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
    </div>
  );
}

/** Scrolls `el` just enough to show bars [start, start + bars) if they are off screen. The lane headers are sticky at the
 * left, so the visible part of the timeline is the viewport minus that column. */
function revealSelection(el: HTMLElement, start: number | undefined, bars: number | undefined): void {
  if (start === undefined || bars === undefined) return;
  const from = COMPOSER_INSET_PX + start * COMPOSER_BAR_PX; // within the lane track
  const to = from + bars * COMPOSER_BAR_PX;
  const visibleFrom = el.scrollLeft; // track coordinates: the track's own origin sits right of the sticky header
  const visibleTo = el.scrollLeft + el.clientWidth - COMPOSER_HEADER_PX;
  if (from < visibleFrom || to > visibleTo) el.scrollLeft = Math.max(0, from - COMPOSER_INSET_PX);
}

function ComposerToolbar(p: ComposerToolbarProps & { getSongText: () => string }) {
  const needs = p.hasSelection ? undefined : "Select a sequence first";
  return (
    <div className="composer-toolbar">
      <span className="composer-status-label">Song</span>
      <RafText className="composer-status-text" getText={p.getSongText} />
      <span className="composer-toolbar-spacer" />
      <button className="btn small" disabled={!p.canNewSequence} onClick={p.onNewSequence} title={p.canNewSequence ? "New empty sequence at the marker (or the end of the selected lane if there is no marker)" : p.blockedReason}>
        + Sequence
      </button>
      <button className="btn small" onClick={p.onAddLane} title="Add a lane">
        + Lane
      </button>
      <button className="btn small" disabled={!p.hasSelection} title={needs ?? "Duplicate as an independent sequence"} onClick={p.onDuplicate}>
        Duplicate
      </button>
      <button className="btn small" disabled={!p.hasSelection} title={needs ?? "Copy this sequence"} onClick={p.onCopy}>
        Copy
      </button>
      <button className="btn small" disabled={!p.canPaste} title={p.canPaste ? "Paste at the marker (or the end of the selected lane if there is no marker)" : p.hasMarker ? "Nothing copied, or it does not fit at the marker: " + p.blockedReason : "Nothing copied"} onClick={p.onPaste}>
        Paste
      </button>
      <button className="btn small danger" disabled={!p.hasSelection} title={needs ?? "Delete this sequence"} onClick={p.onDelete}>
        Delete
      </button>
      <button className="btn small" disabled={!p.hasSelection && !p.hasMarker} title={p.hasMarker ? "Play the song from the marker" : needs ?? "Play the song from the start of this sequence (set a marker to start anywhere)"} onClick={p.onPlayFromHere}>
        ▶ From here
      </button>
      <button className="btn small view-switch-btn" disabled={!p.hasSelection} title={needs ?? "Open this sequence in the sequencer"} onClick={p.onEdit}>
        Edit Sequence ▸
      </button>
    </div>
  );
}
