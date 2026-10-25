// Display side of webdsp's peak metering for the mixer's DOM parts: the "clipping" flag on the master
// strip and the per-track clip dots. The master LEVEL is a canvas (viz/levelMeterView.ts), drawn the
// same way as the EQ spectrum. webdsp's MeterTracker supplies hold/decay state; this file only maps
// it onto elements, writing classes straight to the DOM (no React state), so ~47 updates a second
// never cause a React render.
import type { MeterTracker, BusId } from "webdsp";

export interface ClassToggle {
  classList: { toggle(token: string, force?: boolean): unknown };
}

export interface MeterTargets {
  /** The master strip itself, flagged while the master mix is clipping. */
  masterClip: ClassToggle | null;
  /** Per-track clip dots with the bus each one watches (undefined until the bus exists). */
  trackClips: { el: ClassToggle; bus: BusId | undefined }[];
}

/** Paints the tracker's current state. Safe to call every frame: toggling a class to the value
 * it already has does not touch the DOM. */
export function paintMeters(tracker: MeterTracker, nowMs: number, targets: MeterTargets): void {
  targets.masterClip?.classList.toggle("clipping", tracker.masterClipping(nowMs));
  for (const { el, bus } of targets.trackClips) {
    el.classList.toggle("clip", bus !== undefined && tracker.busClipping(bus, nowMs));
  }
}
