import { describe, expect, it } from "vitest";
import { paintLevelBar, paintSpectrum } from "../src/viz/paint";

// A recording stand-in for CanvasRenderingContext2D: what was filled, in what colour.
function fakeCtx() {
  const rects: { color: string; x: number; y: number; w: number; h: number }[] = [];
  const path: string[] = [];
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 1,
    fillRect(x: number, y: number, w: number, h: number) { rects.push({ color: this.fillStyle, x, y, w, h }); },
    beginPath() { path.push("begin"); }, closePath() {}, fill() { path.push("fill"); }, stroke() { path.push("stroke"); },
    moveTo(x: number, y: number) { path.push(`M${x},${y}`); }, lineTo(x: number, y: number) { path.push(`L${x},${y}`); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, path };
}

const style = { track: "T", fill: "F", danger: "D", tick: "K" };

describe("paintLevelBar", () => {
  it("fills from the bottom to the level in the normal colour below the danger zone", () => {
    const { ctx, rects } = fakeCtx();
    paintLevelBar(ctx, 10, 100, { unit: 0.5, redUnit: 0.9, ticks: [], clipping: false }, style);
    expect(rects.find((r) => r.color === "F")).toMatchObject({ y: 50, h: 50 });
    expect(rects.some((r) => r.color === "D")).toBe(false);
  });
  it("draws the part above the danger threshold, and a cap when clipping, in the danger colour", () => {
    const { ctx, rects } = fakeCtx();
    paintLevelBar(ctx, 10, 100, { unit: 1, redUnit: 0.9, ticks: [0.5], clipping: true }, style);
    const fill = rects.find((r) => r.color === "F")!;
    expect(fill.y).toBeCloseTo(10); expect(fill.h).toBeCloseTo(90);
    const danger = rects.filter((r) => r.color === "D");
    expect(danger[0].y).toBe(0); expect(danger[0].h).toBeCloseTo(10);
    expect(danger[1]).toMatchObject({ y: 0, h: 3 });
    expect(rects.filter((r) => r.color === "K")).toHaveLength(1);
  });
});

describe("paintSpectrum", () => {
  it("closes the filled area to the baseline and strokes the outline", () => {
    const { ctx, path } = fakeCtx();
    paintSpectrum(ctx, Float32Array.from([0, 10, 5, 20, 10, 30]), 3, 40, { fill: "a", stroke: "b" });
    expect(path).toContain("fill");
    expect(path.indexOf("fill")).toBeGreaterThan(-1);
    expect(path.indexOf("M0,10")).toBeGreaterThan(path.indexOf("fill")); // outline starts after the fill
    expect(path[path.length - 1]).toBe("stroke");
  });
});
