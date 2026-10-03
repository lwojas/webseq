// Tracks which beat-columns of a horizontally-scrolling grid are currently in view, so the
// caller can mount only those step cells instead of the full pattern width (ECS-56).
//
// Deliberately does NOT use a `scroll` event handler calling setState: usePlayheadAnimation
// and useRafText already poll the audio clock every frame via their own requestAnimationFrame
// loops, outside React state, specifically so a busy render never delays them. Scrolling this
// grid today costs zero JS (the browser composites it); wiring virtualization to onScroll would
// reintroduce React reconciliation on every scroll tick and starve the playhead's rAF callback
// for the main thread. Instead, this hook reads scrollLeft from its own rAF loop (the same
// clock usePlayheadAnimation/useRafText use) and only commits a state update when the visible
// window's start/end actually moves by a full cell — so most frames, including every frame
// where nothing scrolled, do no React work at all.
import { useEffect, useRef, useState, type RefObject } from "react";

export interface ColumnWindow {
  start: number;
  end: number;
}

/** Pure window math, split out from the rAF loop so it can be unit-tested without a DOM. */
export function computeVisibleColumnWindow(
  scrollLeft: number,
  clientWidth: number,
  pxPerBeat: number,
  totalBeats: number,
  overscanBeats: number,
): ColumnWindow {
  const start = Math.max(0, Math.floor(scrollLeft / pxPerBeat) - overscanBeats);
  const end = Math.min(totalBeats, Math.ceil((scrollLeft + clientWidth) / pxPerBeat) + overscanBeats);
  return { start, end };
}

export function useVisibleColumnWindow(
  scrollRef: RefObject<HTMLElement | null>,
  pxPerBeat: number,
  totalBeats: number,
  overscanBeats: number,
  initialVisibleBeats: number,
): ColumnWindow {
  const [window, setWindow] = useState<ColumnWindow>(() => ({
    start: 0,
    end: Math.min(totalBeats, initialVisibleBeats),
  }));
  const windowRef = useRef(window);

  useEffect(() => {
    let frame: number;
    const tick = () => {
      const el = scrollRef.current;
      if (el) {
        const next = computeVisibleColumnWindow(el.scrollLeft, el.clientWidth, pxPerBeat, totalBeats, overscanBeats);
        const prev = windowRef.current;
        if (next.start !== prev.start || next.end !== prev.end) {
          windowRef.current = next;
          setWindow(next);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [scrollRef, pxPerBeat, totalBeats, overscanBeats]);

  return window;
}
