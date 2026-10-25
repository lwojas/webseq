// The one place a <canvas> visualisation gets its size, pixel ratio and clearing. Every live
// display (EQ spectrum, master meter, future ones) draws through a CanvasSurface, so they all
// resize, scale for hi-dpi and repaint the same way. It owns no loop: callers run their own
// requestAnimationFrame and call begin() only when something changed (see `dirty`).

export class CanvasSurface {
  /** Drawing units. Fixed (e.g. an SVG viewBox the canvas must line up with) or, when omitted,
   * the element's CSS pixel size. */
  width: number;
  height: number;
  /** True after construction and every resize: the next frame must repaint even if data is unchanged. */
  dirty = true;

  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly observer: ResizeObserver;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly fixed?: { width: number; height: number }) {
    this.ctx = canvas.getContext("2d");
    this.width = fixed?.width ?? 1;
    this.height = fixed?.height ?? 1;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (!this.fixed) {
      this.width = this.canvas.clientWidth || 1;
      this.height = this.canvas.clientHeight || 1;
    }
    this.dirty = true;
  }

  /** Clears and returns a context scaled to the drawing units, or null if canvas is unavailable. */
  begin(): CanvasRenderingContext2D | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    ctx.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.dirty = false;
    return ctx;
  }

  dispose(): void {
    this.observer.disconnect();
  }
}
