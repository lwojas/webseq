import { METER_LED_DB, METER_MAX_DB, METER_MIN_DB, METER_RED_DB, MeterTracker, dbToUnit, peakToUnit } from "webdsp";
import { CanvasSurface } from "./canvasSurface";
import { paintLevelBar, type LevelBarStyle } from "./paint";
import { cssColor, withAlpha } from "./theme";

const TICKS = METER_LED_DB.map((db) => dbToUnit(db, METER_MIN_DB, METER_MAX_DB));
const RED_UNIT = dbToUnit(METER_RED_DB, METER_MIN_DB, METER_MAX_DB);

/** The master level as a canvas bar, driven by a MeterTracker (hold/decay already applied there).
 * Call draw() from the caller's frame loop; it repaints only when the bar moved by a pixel or the
 * clip state changed, so a steady or silent meter costs nothing. */
export class LevelMeterView {
  private readonly surface: CanvasSurface;
  private readonly style: LevelBarStyle;
  private lastPx = -1;
  private lastClip = false;

  constructor(canvas: HTMLCanvasElement) {
    this.surface = new CanvasSurface(canvas);
    const danger = cssColor(canvas, "--danger", "#e5484d");
    this.style = {
      track: cssColor(canvas, "--border", "#333"),
      fill: cssColor(canvas, "--accent", "#29e0e0"),
      danger,
      tick: withAlpha(cssColor(canvas, "--panel-alt", "#000"), 0.6),
    };
  }

  draw(tracker: MeterTracker, nowMs: number): void {
    const unit = peakToUnit(tracker.masterLevel());
    const clipping = tracker.masterClipping(nowMs);
    const px = Math.round(unit * this.surface.height);
    if (!this.surface.dirty && px === this.lastPx && clipping === this.lastClip) return;
    this.lastPx = px;
    this.lastClip = clipping;
    const ctx = this.surface.begin();
    if (ctx) paintLevelBar(ctx, this.surface.width, this.surface.height, { unit, redUnit: RED_UNIT, ticks: TICKS, clipping }, this.style);
  }

  dispose(): void {
    this.surface.dispose();
  }
}
