// Shared drawing vocabulary for dB-scaled displays. A spectrum and a level meter are the same
// picture: a filled area under a line on a dB scale, with a danger zone drawn in a warning
// colour. Painters here know nothing about audio sources, EQ or the mixer; they take already
// mapped geometry (webdsp's spectrumPoints / peakToUnit) and colours.

export interface SpectrumStyle {
  fill: string;
  stroke: string;
}

/** Filled area plus outline through `columns` x,y pairs (drawing units, y down). */
export function paintSpectrum(ctx: CanvasRenderingContext2D, pts: Float32Array, columns: number, height: number, style: SpectrumStyle): void {
  const last = columns - 1;
  ctx.beginPath();
  ctx.moveTo(pts[0], height);
  for (let i = 0; i <= last; i++) ctx.lineTo(pts[2 * i], pts[2 * i + 1]);
  ctx.lineTo(pts[2 * last], height);
  ctx.closePath();
  ctx.fillStyle = style.fill;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i <= last; i++) ctx.lineTo(pts[2 * i], pts[2 * i + 1]);
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export interface LevelBarStyle {
  track: string;
  fill: string;
  /** Colour of the part of the bar above `redUnit`, and of the clip cap. */
  danger: string;
  /** Faint scale ticks. */
  tick: string;
}

export interface LevelBar {
  /** Current level, 0..1 up the bar (webdsp peakToUnit). */
  unit: number;
  /** Where the danger zone starts, 0..1. */
  redUnit: number;
  /** Tick positions, 0..1. */
  ticks: readonly number[];
  /** Lit while the signal is clipping. */
  clipping: boolean;
}

/** A vertical level bar filling the drawing area from the bottom, same dB scale as the spectrum. */
export function paintLevelBar(ctx: CanvasRenderingContext2D, w: number, h: number, bar: LevelBar, style: LevelBarStyle): void {
  const y = (u: number) => h * (1 - u);
  ctx.fillStyle = style.track;
  ctx.fillRect(0, 0, w, h);
  const top = y(bar.unit);
  const redY = y(bar.redUnit);
  ctx.fillStyle = style.fill;
  ctx.fillRect(0, Math.max(top, redY), w, h - Math.max(top, redY));
  if (top < redY) {
    ctx.fillStyle = style.danger;
    ctx.fillRect(0, top, w, redY - top);
  }
  ctx.fillStyle = style.tick;
  for (const t of bar.ticks) ctx.fillRect(0, Math.round(y(t)), w, 1);
  if (bar.clipping) {
    ctx.fillStyle = style.danger;
    ctx.fillRect(0, 0, w, Math.min(3, h));
  }
}
