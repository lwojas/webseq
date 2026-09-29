import { useRef } from "react";
import type { FxParamDef } from "../model/fx";
import type { AutomationLane as AutomationLaneModel } from "../model/types";
import { valueAtBeat } from "../model/automation";
import { BEAT_WIDTH_PX } from "./timelineConstants";

interface Props {
  lane: AutomationLaneModel | undefined;
  paramDef: FxParamDef;
  totalBeats: number;
  onSetPoint: (position: number, value: number) => void;
  onRemovePoint: (position: number) => void;
  onClear: () => void;
}

const HEIGHT = 64;
const CLICK_VS_DRAG_PX = 4;

function valueToY(value: number, def: FxParamDef): number {
  const t = (value - def.min) / (def.max - def.min || 1);
  return HEIGHT - Math.min(1, Math.max(0, t)) * HEIGHT;
}

function yToValue(y: number, def: FxParamDef): number {
  const t = 1 - Math.min(1, Math.max(0, y / HEIGHT));
  return def.min + t * (def.max - def.min);
}

/** The one automation lane currently being edited — shown only for the selected FX's selected
 * parameter (see ModulePanel), never all of a track's automation at once, per project brief
 * section 15 ("keep automation visually clean"). Sparse points, linear interpolation between
 * them, matching model/types.ts's AutomationLane contract exactly — this is a direct picture
 * of that data, not a separate curve representation. Positions are scoped to the pattern
 * currently open in the timeline (see PatternBar) for editing purposes, even though playback
 * (Transport) evaluates a lane against whichever chain step is actually sounding — see
 * Transport.pollAutomation's doc comment for that distinction. */
export function AutomationLane({ lane, paramDef, totalBeats, onSetPoint, onRemovePoint, onClear }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const width = totalBeats * BEAT_WIDTH_PX;
  const events = lane?.events ?? [];

  // A light preview curve so the shape is visible even with only sparse points, using the
  // exact same interpolation/hold rule playback uses (see automation.ts's valueAtBeat).
  const previewPoints: string[] = [];
  if (events.length > 0) {
    for (let beat = 0; beat <= totalBeats; beat += 0.25) {
      const v = valueAtBeat(lane, beat) ?? paramDef.default;
      previewPoints.push(`${beat * BEAT_WIDTH_PX},${valueToY(v, paramDef)}`);
    }
  }

  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const beat = Math.max(0, Math.round(((e.clientX - rect.left) / BEAT_WIDTH_PX) * 4) / 4);
    const value = yToValue(e.clientY - rect.top, paramDef);
    onSetPoint(beat, value);
  };

  const beginDragPoint = (e: React.MouseEvent, position: number, value: number) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let lastBeat = position;
    let lastValue = value;

    const onMouseMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startX) > CLICK_VS_DRAG_PX || Math.abs(ev.clientY - startY) > CLICK_VS_DRAG_PX) {
        moved = true;
      }
      lastBeat = Math.max(0, Math.round(((ev.clientX - rect.left) / BEAT_WIDTH_PX) * 4) / 4);
      lastValue = yToValue(ev.clientY - rect.top, paramDef);
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (!moved) {
        onRemovePoint(position); // plain click on a point removes it
      } else {
        if (lastBeat !== position) onRemovePoint(position);
        onSetPoint(lastBeat, lastValue);
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div className="automation-lane-wrap">
      <div className="automation-lane-header">
        <span>{paramDef.label} automation</span>
        {events.length > 0 && (
          <button className="btn small" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      <div className="automation-lane" style={{ width, height: HEIGHT }} ref={containerRef} onMouseDown={handleBackgroundMouseDown}>
        {previewPoints.length > 0 && (
          <svg className="automation-curve" width={width} height={HEIGHT}>
            <polyline points={previewPoints.join(" ")} fill="none" />
          </svg>
        )}
        {events.map((ev) => (
          <div
            key={ev.position}
            className="automation-point"
            style={{ left: ev.position * BEAT_WIDTH_PX, top: valueToY(ev.value, paramDef) }}
            onMouseDown={(e) => beginDragPoint(e, ev.position, ev.value)}
            title={`beat ${ev.position}: ${ev.value.toFixed(2)}${paramDef.unit ?? ""}`}
          />
        ))}
      </div>
    </div>
  );
}
