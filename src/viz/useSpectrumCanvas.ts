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

interface Options {
  /** Drawing units (match the SVG viewBox the canvas sits behind). */
  width: number;
  height: number;
  minDb: number;
  maxDb: number;
  /** The effect's OUTPUT: the main, brighter fill. */
  main: SpectrumStyle;
  /** The effect's INPUT, drawn fainter behind the output; omit to show only the output. */
  input?: SpectrumStyle;
}

/** Paints a live spectrum into `canvasRef` while mounted: the effect's output as the main fill and,
 * optionally, its input fainter behind it, so the gap shows what the effect changes. All work is outside React: one
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
    const output = new SpectrumAnalyzer();
    const input = new SpectrumAnalyzer();
    const pts = new Float32Array(output.columns * 2);
    let outFeed: SpectrumFeed | null = null;
    let inFeed: SpectrumFeed | null = null;
    let raf = 0;

    const paint = (ctx: CanvasRenderingContext2D, a: SpectrumAnalyzer, style: SpectrumStyle) => {
      const o = optsRef.current;
      spectrumPoints(a, surface.width, surface.height, o.minDb, o.maxDb, pts);
      paintSpectrum(ctx, pts, a.columns, surface.height, style);
    };

    const loop = (now: number) => {
      if (!outFeed) {
        const tap = resolveRef.current();
        if (tap) {
          outFeed = new SpectrumFeed(tap.source, tap.bus, tap.effect, true, output);
          if (optsRef.current.input) inFeed = new SpectrumFeed(tap.source, tap.bus, tap.effect, false, input);
        }
      }
      const outChanged = outFeed ? outFeed.frame(now) : false;
      const inChanged = inFeed ? inFeed.frame(now) : false;
      if (outChanged || inChanged || surface.dirty) {
        const o = optsRef.current;
        const ctx = surface.begin();
        if (ctx) {
          if (inFeed && o.input) paint(ctx, input, o.input);
          paint(ctx, output, o.main);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      surface.dispose();
      outFeed?.dispose();
      inFeed?.dispose();
    };
  }, [canvasRef, key]);
}
