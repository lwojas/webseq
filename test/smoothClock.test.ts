import { describe, expect, it } from "vitest";
import { createSmoothClock } from "../src/audio/smoothClock";

// A source that only advances in 20 ms steps, like AudioContext.currentTime on a phone.
function steppedClock(step: number) {
  let perf = 0;
  return {
    perfNow: () => perf,
    source: () => Math.floor(perf / step) * step,
    advance: (dt: number) => {
      perf += dt;
    },
  };
}

describe("createSmoothClock", () => {
  it("changes every frame even when the source only steps every 20ms", () => {
    const c = steppedClock(0.02);
    const clock = createSmoothClock(c.source, c.perfNow);
    const values: number[] = [];
    for (let i = 0; i < 60; i++) {
      c.advance(1 / 90);
      values.push(clock());
    }
    // Skip the first buffer while the estimate locks on.
    const later = values.slice(6);
    for (let i = 1; i < later.length; i++) expect(later[i]).toBeGreaterThan(later[i - 1]);
  });

  it("stays within one buffer of the source and is never behind it", () => {
    const c = steppedClock(0.02);
    const clock = createSmoothClock(c.source, c.perfNow);
    for (let i = 0; i < 600; i++) {
      c.advance(1 / 60);
      const v = clock();
      expect(v).toBeGreaterThanOrEqual(c.source() - 1e-9);
      expect(v - c.source()).toBeLessThanOrEqual(0.02 + 1e-9);
    }
  });

  it("never goes backwards while the source is steady", () => {
    const c = steppedClock(0.04);
    const clock = createSmoothClock(c.source, c.perfNow);
    let prev = -Infinity;
    for (let i = 0; i < 500; i++) {
      c.advance(0.007);
      const v = clock();
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("resyncs when the source jumps (context suspended and resumed)", () => {
    let perf = 0;
    let src = 0;
    const clock = createSmoothClock(() => src, () => perf);
    for (let i = 0; i < 10; i++) {
      perf += 0.016;
      src = perf;
      clock();
    }
    // The audio context was suspended for 5 s: perf kept running, the source didn't.
    perf += 5;
    expect(clock()).toBeCloseTo(src, 6);
  });
});
