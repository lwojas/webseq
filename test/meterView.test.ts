import { describe, expect, it } from "vitest";
import { METER_LED_DB, MeterTracker, emptyMeters } from "webdsp";
import { paintMeters, type ClassToggle } from "../src/audio/meterView";

class FakeEl implements ClassToggle {
  classes = new Set<string>();
  classList = {
    toggle: (token: string, force?: boolean) => {
      if (force ?? !this.classes.has(token)) this.classes.add(token);
      else this.classes.delete(token);
    },
  };
  has(c: string) { return this.classes.has(c); }
}

function targets() {
  return {
    leds: METER_LED_DB.map(() => new FakeEl()),
    masterClip: new FakeEl(),
    trackClips: [new FakeEl(), new FakeEl(), new FakeEl()].map((el, i) => ({ el, bus: i === 2 ? undefined : i + 1 })),
  };
}

function snapshot(masterIn: number, buses: Record<number, number> = {}) {
  const s = emptyMeters(64);
  s.masterIn = masterIn;
  for (const [b, v] of Object.entries(buses)) s.buses[Number(b) - 1] = v;
  return s;
}

describe("paintMeters", () => {
  it("lights master LEDs progressively and marks the top ones red", () => {
    const t = new MeterTracker(64);
    const tg = targets();
    t.update(snapshot(0.1), 0);
    paintMeters(t, 0, tg);
    const lit = tg.leds.filter((l) => l.has("lit")).length;
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(METER_LED_DB.length - 3);
    expect(tg.leds.slice(-3).every((l) => l.has("red"))).toBe(true);
    expect(tg.leds[0].has("red")).toBe(false);
    expect(tg.masterClip.has("clipping")).toBe(false);
  });

  it("flags clipping on the right track only, and clears after the hold", () => {
    const t = new MeterTracker(64, { clipHoldMs: 1000 });
    const tg = targets();
    t.update(snapshot(1.2, { 2: 1.1, 1: 0.4 }), 0);
    paintMeters(t, 0, tg);
    expect(tg.trackClips.map((c) => (c.el as FakeEl).has("clip"))).toEqual([false, true, false]);
    expect(tg.masterClip.has("clipping")).toBe(true);
    expect(tg.leds.every((l) => l.has("lit"))).toBe(true);
    t.update(snapshot(0), 1500);
    paintMeters(t, 1500, tg);
    expect((tg.trackClips[1].el as FakeEl).has("clip")).toBe(false);
    expect(tg.masterClip.has("clipping")).toBe(false);
  });
});
