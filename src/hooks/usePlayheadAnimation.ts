// Renders the playhead via a requestAnimationFrame loop that imperatively mutates a DOM
// node's style — deliberately NOT React state. The audio engine is the authoritative clock
// (see Transport.getPlayheadBeat, itself derived from AudioRuntime.getCurrentTime()); this
// hook only ever reads that clock to redraw, so a slow/throttled React render never desyncs
// audio, and a busy render never desyncs the playhead either — the two are fully decoupled.
//
// Position is in pixels (beat * a fixed per-beat width), not a percentage — see
// SequencerGrid's doc comment on why the timeline now uses fixed-width beat columns (for the
// 2-bar viewport + horizontal scroll) rather than a 100%-stretched grid. `getBeat` returning
// null means "not currently visible" (the pattern this playhead belongs to isn't the one
// actually playing right now — see Transport.getPlayheadInfo) — the playhead simply hides
// rather than snapping to 0, per the brief's "playhead may fall outside the viewport, don't
// auto-scroll" guidance: it's fine for it to be off-screen, but it should never lie about
// which pattern is playing.
import { useEffect, useRef } from "react";

export function usePlayheadAnimation(getBeat: () => number | null, pxPerBeat: number) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let frame: number;
    const draw = () => {
      const el = elementRef.current;
      if (el) {
        const beat = getBeat();
        if (beat === null) {
          el.style.display = "none";
        } else {
          el.style.display = "";
          el.style.left = `${beat * pxPerBeat}px`;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [getBeat, pxPerBeat]);

  return elementRef;
}
