import { useEffect, useState } from "react";
import {
  DEFAULT_ZOOM_INDEX,
  MAX_ZOOM_INDEX_COARSE,
  MAX_ZOOM_INDEX_FINE,
  MIN_ZOOM_INDEX_COARSE,
  MIN_ZOOM_INDEX_FINE,
  ZOOM_LEVELS_PX_PER_BEAT,
} from "../components/timelineConstants";

function clamp(index: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, index));
}

/** Owns the timeline's bounded discrete zoom level (see timelineConstants.ts's doc comment on
 * ZOOM_LEVELS_PX_PER_BEAT — ECS-53). Min/max bounds depend on pointer type (fine vs coarse) and
 * are re-read live via a matchMedia listener, the same signal index.css's `@media (pointer:
 * coarse)` block already reacts to, so a 2-in-1 laptop switching between mouse and touchscreen
 * stays consistent between CSS and this clamp. */
export function useTimelineZoom() {
  const [coarse, setCoarse] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)");
    const onChange = () => setCoarse(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const minIndex = coarse ? MIN_ZOOM_INDEX_COARSE : MIN_ZOOM_INDEX_FINE;
  const maxIndex = coarse ? MAX_ZOOM_INDEX_COARSE : MAX_ZOOM_INDEX_FINE;

  const [zoomIndex, setZoomIndexState] = useState(() => clamp(DEFAULT_ZOOM_INDEX, minIndex, maxIndex));

  // Re-clamp if the bounds change under us (pointer type change mid-session).
  useEffect(() => {
    setZoomIndexState((i) => clamp(i, minIndex, maxIndex));
  }, [minIndex, maxIndex]);

  const setZoomIndex = (index: number) => setZoomIndexState(clamp(index, minIndex, maxIndex));

  return {
    pxPerBeat: ZOOM_LEVELS_PX_PER_BEAT[zoomIndex],
    zoomPercent: Math.round((ZOOM_LEVELS_PX_PER_BEAT[zoomIndex] / ZOOM_LEVELS_PX_PER_BEAT[DEFAULT_ZOOM_INDEX]) * 100),
    canZoomIn: zoomIndex < maxIndex,
    canZoomOut: zoomIndex > minIndex,
    onZoomIn: () => setZoomIndex(zoomIndex + 1),
    onZoomOut: () => setZoomIndex(zoomIndex - 1),
  };
}
