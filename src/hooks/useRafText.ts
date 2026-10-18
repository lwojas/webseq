// Same rationale as usePlayheadAnimation: drives a piece of on-screen text (the transport's
// Bar/Beat readout, the "bar 2 / 4" readouts) from a per-frame read of the engine clock without
// putting that value into React state, so the audio clock never has to wait on a React render to
// be read.
//
// The text is only WRITTEN when it changed. Assigning `textContent` replaces the text node even
// for an identical string, which dirties layout every frame, and the next loop's layout reads
// (useVisibleColumnWindow's clientWidth) would then force a synchronous layout. Tracking the last
// value per element also means a span that mounts later (the resample status) still gets its first
// write.
import { useEffect, useRef } from "react";

export function useRafText(getText: () => string) {
  const elementRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let frame: number;
    let lastEl: HTMLSpanElement | null = null;
    let lastText: string | null = null;
    const draw = () => {
      const el = elementRef.current;
      if (el) {
        const text = getText();
        if (el !== lastEl || text !== lastText) {
          el.textContent = text;
          lastEl = el;
          lastText = text;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [getText]);

  return elementRef;
}
