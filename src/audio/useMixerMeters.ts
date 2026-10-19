import { MAX_TRACK_BUSES, MeterTracker, type AudioRuntime, type BusId } from "webdsp";
import { useEffect, type RefObject } from "react";
import type { FxTarget } from "../model/types";
import { paintMeters, type ClassToggle } from "./meterView";

/** Feeds webdsp's peak snapshots into the mixer's meter elements. `rootRef` is the mixer panel;
 * its `[data-meter-led]` (master), `[data-master-strip]` and `[data-clip-track]` (one per track
 * strip) descendants are found once per `layoutKey` change (bank paging). Snapshots arrive ~47
 * times a second from the engine; painting runs on animation frames and stops when the mixer
 * is unmounted, so a hidden mixer costs nothing. */
export function useMixerMeters(
  runtime: AudioRuntime | null,
  rootRef: RefObject<HTMLElement | null>,
  getBusId: (target: FxTarget) => BusId | undefined,
  layoutKey: unknown,
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!runtime || !root) return;
    const tracker = new MeterTracker(MAX_TRACK_BUSES);
    const unsubscribe = runtime.onMeters((snapshot) => tracker.update(snapshot, performance.now()));

    const leds = Array.from(root.querySelectorAll<HTMLElement>("[data-meter-led]"));
    const masterClip: ClassToggle | null = root.querySelector<HTMLElement>("[data-master-strip]");
    const clipEls = Array.from(root.querySelectorAll<HTMLElement>("[data-clip-track]"));
    let frame = 0;
    const draw = () => {
      paintMeters(tracker, performance.now(), {
        leds,
        masterClip,
        trackClips: clipEls.map((el) => ({ el, bus: getBusId(el.dataset.clipTrack ?? "") })),
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [runtime, rootRef, getBusId, layoutKey]);
}
