import { useEffect, useRef, type RefObject } from "react";
import { SpectrumAnalyzer, SpectrumFeed, spectrumPoints, type SpectrumSource } from "webdsp";
import { CanvasSurface } from "./canvasSurface";
import { paintSpectrum, type SpectrumStyle } from "./paint";

/** What to listen to: the input of one engine effect. */
export interface SpectrumTap {
  source: SpectrumSource;
  bus: number;
  effect: number;
}

interface Options extends SpectrumStyle {
  /** Drawing units (match the SVG viewBox the canvas sits behind). */
  width: number;
  height: number;
  minDb: number;
  maxDb: number;
}

/** Paints a live spectrum into `canvasRef` while mounted. All work is outside React: one
 * requestAnimationFrame loop that only touches the canvas, never state, so it cannot cause a React
 * render and runs only while this view exists (rAF pauses with the tab). It redraws only when the
 * spectrum changed, and does nothing once it has fallen to silence. `resolve` is polled until the
 * engine effect exists (the FX sync runs after first render). */
export function useSpectrumCanvas(canvasRef: RefObject<HTMLCanvasElement | null>, resolve: () => SpectrumTap | null, key: string, opts: Options): void {
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const surface = new CanvasSurface(canvas, { width: optsRef.current.width, height: optsRef.current.height });
    const analyzer = new SpectrumAnalyzer();
    const pts = new Float32Array(analyzer.columns * 2);
    let feed: SpectrumFeed | null = null;
    let raf = 0;

    const loop = (now: number) => {
      if (!feed) {
        const tap = resolveRef.current();
        if (tap) feed = new SpectrumFeed(tap.source, tap.bus, tap.effect, analyzer);
      }
      if ((feed && feed.frame(now)) || surface.dirty) {
        const o = optsRef.current;
        const ctx = surface.begin();
        if (ctx) {
          spectrumPoints(analyzer, surface.width, surface.height, o.minDb, o.maxDb, pts);
          paintSpectrum(ctx, pts, analyzer.columns, surface.height, o);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      surface.dispose();
      feed?.dispose();
    };
  }, [canvasRef, key]);
}
