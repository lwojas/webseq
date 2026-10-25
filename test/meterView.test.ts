import { describe, expect, it } from "vitest";
import { MeterTracker, emptyMeters } from "webdsp";
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
  it("leaves the master strip unflagged for a quiet signal", () => {
    const t = new MeterTracker(64);
    const tg = targets();
    t.update(snapshot(0.1), 0);
    paintMeters(t, 0, tg);
    expect(tg.masterClip.has("clipping")).toBe(false);
  });

  it("flags clipping on the right track only, and clears after the hold", () => {
    const t = new MeterTracker(64, { clipHoldMs: 1000 });
    const tg = targets();
    t.update(snapshot(1.2, { 2: 1.1, 1: 0.4 }), 0);
    paintMeters(t, 0, tg);
    expect(tg.trackClips.map((c) => (c.el as FakeEl).has("clip"))).toEqual([false, true, false]);
    expect(tg.masterClip.has("clipping")).toBe(true);
    t.update(snapshot(0), 1500);
    paintMeters(t, 1500, tg);
    expect((tg.trackClips[1].el as FakeEl).has("clip")).toBe(false);
    expect(tg.masterClip.has("clipping")).toBe(false);
  });
});
