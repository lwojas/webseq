// Display side of webdsp's peak metering for the mixer. The engine measures peaks and webdsp's
// MeterTracker turns them into hold/decay display state; this file only maps that state onto
// elements. It writes classes straight to the DOM (no React state), so ~47 meter updates a
// second never cause a React render.
import { METER_LED_DB, METER_RED_LEDS, MeterTracker, type BusId } from "webdsp";

export interface ClassToggle {
  classList: { toggle(token: string, force?: boolean): unknown };
}

export interface MeterTargets {
  /** Master LED elements, lowest first (METER_LED_DB.length of them). */
  leds: ClassToggle[];
  /** The master strip itself, flagged while the master mix is clipping. */
  masterClip: ClassToggle | null;
  /** Per-track clip dots with the bus each one watches (undefined until the bus exists). */
  trackClips: { el: ClassToggle; bus: BusId | undefined }[];
}

/** Paints the tracker's current state. Safe to call every frame: toggling a class to the value
 * it already has does not touch the DOM. */
export function paintMeters(tracker: MeterTracker, nowMs: number, targets: MeterTargets): void {
  const lit = tracker.masterLitLeds();
  targets.leds.forEach((el, i) => {
    el.classList.toggle("lit", i < lit);
    el.classList.toggle("red", i >= METER_LED_DB.length - METER_RED_LEDS);
  });
  targets.masterClip?.classList.toggle("clipping", tracker.masterClipping(nowMs));
  for (const { el, bus } of targets.trackClips) {
    el.classList.toggle("clip", bus !== undefined && tracker.busClipping(bus, nowMs));
  }
}
