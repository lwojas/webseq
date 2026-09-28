// Renders the playhead via a requestAnimationFrame loop that imperatively mutates a DOM
// node's style — deliberately NOT React state. The audio engine is the authoritative clock
// (see Transport.getPlayheadBeat, itself derived from AudioRuntime.getCurrentTime()); this
// hook only ever reads that clock to redraw, so a slow/throttled React render never desyncs
// audio, and a busy render never desyncs the playhead either — the two are fully decoupled.
import { useEffect, useRef } from "react";

export function usePlayheadAnimation(getBeat: () => number, getTotalBeats: () => number) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let frame: number;
    const draw = () => {
      const el = elementRef.current;
      if (el) {
        const total = getTotalBeats();
        const beat = getBeat();
        const pct = total > 0 ? (beat / total) * 100 : 0;
        el.style.left = `${pct}%`;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [getBeat, getTotalBeats]);

  return elementRef;
}
