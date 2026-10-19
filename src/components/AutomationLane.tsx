import { useRef } from "react";
import type { AutomationEvent, AutomationLane as AutomationLaneModel } from "../model/types";
import { normalizedToValue, valueToNormalized, type ModParamDef } from "../model/modulation";

interface Props {
  lane: AutomationLaneModel | undefined;
  paramDef: ModParamDef;
  totalBeats: number;
  beatsPerBar: number;
  /** Current timeline zoom level, in pixels per beat. The lane is exactly `totalBeats * pxPerBeat`
   * wide and is meant to be mounted inside the timeline's own scroll area (AutomationRow), so a
   * point lines up with the matching beat of the grid and scrolls with it (timelineConstants.ts). */
  pxPerBeat: number;
  height?: number;
  /** Beat range currently scrolled into view (from the grid's visible-column window). Only points
   * inside it (plus a one-beat margin) are mounted as elements; omitted = all. */
  visibleStart?: number;
  visibleEnd?: number;
  onSetPoint: (position: number, value: number) => void;
  onRemovePoint: (position: number) => void;
}

export const AUTOMATION_LANE_HEIGHT = 64;
const CLICK_VS_DRAG_PX = 4;
const GRID = 4; // positions are quarter-beat quantized (model/automation.ts)

/** "1 bar" / "4 bars" / "2.5 bars". */
export function formatBars(bars: number): string {
  const n = Math.round(bars * 100) / 100;
  return `${n} ${n === 1 ? "bar" : "bars"}`;
}

/** The curve as [beat, value] vertices. Playback interpolates linearly between points and holds the
 * first/last value outside them, so the breakpoints (plus the two hold ends) ARE the curve: exact,
 * and O(points), not O(samples x points). */
export function curveVertices(events: readonly AutomationEvent[], totalBeats: number): [number, number][] {
  if (events.length === 0) return [];
  const v: [number, number][] = [];
  if (events[0].position > 0) v.push([0, events[0].value]);
  for (const e of events) v.push([e.position, e.value]);
  const last = events[events.length - 1];
  if (last.position < totalBeats) v.push([totalBeats, last.value]);
  return v;
}

/** The points worth mounting for a visible beat range: those within one beat of it. */
export function visibleEvents(events: readonly AutomationEvent[], start: number | undefined, end: number | undefined): AutomationEvent[] {
  if (start === undefined || end === undefined) return events as AutomationEvent[];
  return events.filter((e) => e.position >= start - 1 && e.position <= end + 1);
}

/** The automation curve for one parameter, drawn at the timeline's own scale: sparse points,
 * linear interpolation between them, matching model/types.ts's AutomationLane contract exactly.
 * Hz / seconds parameters are drawn on a log axis (the same octave domain the engine's LFOs use),
 * so a cutoff sweep reads as a straight line. Bar boundaries are marked and numbered, so the
 * lane's length in bars is visible at a glance. Pointer events, so it works by touch as well. */
export function AutomationLane({ lane, paramDef, totalBeats, beatsPerBar, pxPerBeat, height = AUTOMATION_LANE_HEIGHT, visibleStart, visibleEnd, onSetPoint, onRemovePoint }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const width = totalBeats * pxPerBeat;
  const events = lane?.events ?? [];
  const bars = Math.max(1, Math.round(totalBeats / beatsPerBar));

  const valueToY = (value: number) => height - valueToNormalized(paramDef, value) * height;
  const yToValue = (y: number) => {
    const v = normalizedToValue(paramDef, 1 - Math.min(1, Math.max(0, y / height)));
    return paramDef.step >= 1 ? Math.round(v / paramDef.step) * paramDef.step : v;
  };
  const xToBeat = (x: number) => Math.min(totalBeats, Math.max(0, Math.round((x / pxPerBeat) * GRID) / GRID));

  const previewPoints = curveVertices(events, totalBeats).map(([beat, value]) => `${beat * pxPerBeat},${valueToY(value)}`);

  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    onSetPoint(xToBeat(e.clientX - rect.left), yToValue(e.clientY - rect.top));
  };

  const beginDragPoint = (e: React.PointerEvent, position: number, value: number) => {
    e.stopPropagation();
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let lastBeat = position;
    let lastValue = value;

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > CLICK_VS_DRAG_PX || Math.abs(ev.clientY - startY) > CLICK_VS_DRAG_PX) moved = true;
      lastBeat = xToBeat(ev.clientX - rect.left);
      lastValue = yToValue(ev.clientY - rect.top);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!moved) {
        onRemovePoint(position); // plain click/tap on a point removes it
      } else {
        if (lastBeat !== position) onRemovePoint(position);
        onSetPoint(lastBeat, lastValue);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div className="automation-lane" style={{ width, height }} ref={containerRef} onPointerDown={handleBackgroundPointerDown}>
      {Array.from({ length: bars }, (_, bar) => (
        <div key={bar} className="automation-bar-mark" style={{ left: bar * beatsPerBar * pxPerBeat }}>
          <span>{bar + 1}</span>
        </div>
      ))}
      {previewPoints.length > 0 && (
        <svg className="automation-curve" width={width} height={height}>
          <polyline points={previewPoints.join(" ")} fill="none" />
        </svg>
      )}
      {visibleEvents(events, visibleStart, visibleEnd).map((ev) => (
        <div
          key={ev.position}
          className="automation-point"
          style={{ left: ev.position * pxPerBeat, top: valueToY(ev.value) }}
          onPointerDown={(e) => beginDragPoint(e, ev.position, ev.value)}
          title={`beat ${ev.position}: ${ev.value.toFixed(2)}${paramDef.unit ?? ""}`}
        />
      ))}
    </div>
  );
}
