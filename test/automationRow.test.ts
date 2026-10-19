import { describe, expect, it } from "vitest";
import { sameAutomationRow, type Props } from "../src/components/AutomationRow";
import { curveVertices, visibleEvents } from "../src/components/AutomationLane";
import { AUTOMATION_TEMPLATES, applyTemplate } from "../src/model/automationTemplates";
import { valueAtBeat } from "../src/model/automation";
import type { AutomationLane } from "../src/model/types";

const noop = () => {};
const paramDef = { id: "cutoff", label: "Cutoff", min: 40, max: 18000, step: 1, unit: "Hz", default: 18000, scale: "log" as const };
const lane: AutomationLane = { parameter: "cutoff", events: [{ position: 0, value: 100 }] };
const base: Props = {
  label: "Filter · Cutoff",
  lane,
  paramDef,
  totalBeats: 64,
  beatsPerBar: 16,
  pxPerBeat: 28,
  visibleStart: 0,
  visibleEnd: 64,
  onSetPoint: noop,
  onRemovePoint: noop,
  onClose: noop,
};

describe("AutomationRow's memo comparator", () => {
  it("is equal for identical props, and for a paramDef rebuilt with the same values", () => {
    expect(sameAutomationRow(base, { ...base })).toBe(true);
    expect(sameAutomationRow(base, { ...base, paramDef: { ...paramDef } })).toBe(true);
  });

  it("re-renders when ANY prop changes (guards a prop added without updating the comparator)", () => {
    const changed: Record<string, unknown> = {
      label: "other",
      lane: { ...lane },
      paramDef: { ...paramDef, max: 20000 },
      totalBeats: 32,
      beatsPerBar: 8,
      pxPerBeat: 40,
      visibleStart: 8,
      visibleEnd: 32,
      onSetPoint: () => {},
      onRemovePoint: () => {},
      onClose: () => {},
    };
    for (const key of Object.keys(base)) expect(changed, `test is missing prop "${key}"`).toHaveProperty(key);
    for (const [key, value] of Object.entries(changed)) {
      expect(sameAutomationRow(base, { ...base, [key]: value }), `prop "${key}" must trigger a re-render`).toBe(false);
    }
  });
});

describe("lane rendering cost", () => {
  // The densest realistic lane: an 8-bar sequence, a fine cyclic template on a log parameter.
  const bpb = 16;
  const total = 8 * bpb;
  const dense = AUTOMATION_TEMPLATES.map((t) => applyTemplate(t, "all", paramDef, total, bpb).events).sort((a, b) => b.length - a.length)[0];

  it("the curve is the breakpoints themselves: O(points), and exactly what playback evaluates", () => {
    expect(dense.length).toBeGreaterThan(100);
    const v = curveVertices(dense, total);
    expect(v.length).toBeLessThanOrEqual(dense.length + 2);
    const l: AutomationLane = { parameter: "cutoff", events: dense };
    // Between vertices the drawn line is straight, as is playback: check midpoints against valueAtBeat.
    for (let i = 0; i < v.length - 1; i++) {
      const [x0, y0] = v[i];
      const [x1, y1] = v[i + 1];
      if (x1 === x0) continue;
      const mid = (x0 + x1) / 2;
      expect(valueAtBeat(l, mid)!).toBeCloseTo((y0 + y1) / 2, 6);
    }
  });

  it("holds the first and last value out to the lane's edges", () => {
    const v = curveVertices([{ position: 4, value: 1 }, { position: 8, value: 2 }], 16);
    expect(v).toEqual([[0, 1], [4, 1], [8, 2], [16, 2]]);
    expect(curveVertices([], 16)).toEqual([]);
  });

  it("mounts only the points near the visible window", () => {
    const visible = visibleEvents(dense, 32, 48);
    expect(visible.length).toBeLessThan(dense.length / 3);
    expect(visible.every((e) => e.position >= 31 && e.position <= 49)).toBe(true);
    expect(visibleEvents(dense, undefined, undefined)).toBe(dense);
  });

  it("building the curve and the visible set stays cheap for a dense lane", () => {
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      curveVertices(dense, total);
      visibleEvents(dense, 32, 48);
    }
    // 500 renders' worth in well under a second even on a slow CI box (typically a few ms).
    expect(performance.now() - start).toBeLessThan(500);
  });
});
