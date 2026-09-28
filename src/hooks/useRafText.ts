// Same rationale as usePlayheadAnimation: drives a piece of on-screen text (the transport's
// Bar/Beat readout) from a per-frame read of the engine clock without putting that value
// into React state, so the audio clock never has to wait on a React render to be read.
import { useEffect, useRef } from "react";

export function useRafText(getText: () => string) {
  const elementRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let frame: number;
    const draw = () => {
      const el = elementRef.current;
      if (el) el.textContent = getText();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [getText]);

  return elementRef;
}
