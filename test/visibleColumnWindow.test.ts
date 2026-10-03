import { describe, expect, it } from "vitest";
import { computeVisibleColumnWindow } from "../src/hooks/useVisibleColumnWindow";

describe("computeVisibleColumnWindow", () => {
  it("covers the scrolled-into-view range plus overscan on both sides", () => {
    // scrollLeft 100px, 200px-wide viewport, 10px/beat -> beats 10..30 visible, +4 overscan.
    expect(computeVisibleColumnWindow(100, 200, 10, 1000, 4)).toEqual({ start: 6, end: 34 });
  });

  it("clamps the start to 0 near the left edge", () => {
    expect(computeVisibleColumnWindow(0, 200, 10, 1000, 4)).toEqual({ start: 0, end: 24 });
  });

  it("clamps the end to the pattern's total beat count near the right edge", () => {
    expect(computeVisibleColumnWindow(900, 200, 10, 100, 4)).toEqual({ start: 86, end: 100 });
  });

  it("clamps both ends when the whole pattern fits within one viewport", () => {
    expect(computeVisibleColumnWindow(0, 500, 10, 20, 4)).toEqual({ start: 0, end: 20 });
  });

  it("shifts the window as scrollLeft increases, without changing its width", () => {
    const a = computeVisibleColumnWindow(160, 200, 16, 10_000, 8);
    const b = computeVisibleColumnWindow(176, 200, 16, 10_000, 8);
    expect(a).toEqual({ start: 2, end: 31 });
    expect(b).toEqual({ start: 3, end: 32 });
  });
});
