import { describe, expect, it } from "vitest";
import { lanesInPattern, projectInPattern } from "../src/model/patternAutomation";
import { projectReducer } from "../src/model/reducer";
import { addPattern, createInitialProject } from "../src/model/project";

describe("a pattern's own automation", () => {
  const base = addPattern(createInitialProject());
  const [a, b] = base.patterns.map((p) => p.id);
  const point = { type: "SET_AUTOMATION_POINT" as const, target: "track-1", fxId: null, parameter: "cutoff", position: 0, value: 0.2 };

  it("editing a lane for pattern A leaves the track's lanes and pattern B alone", () => {
    const next = projectReducer(base, { ...point, patternId: a });
    expect(next.tracks[0].automation).toEqual([]);
    expect(lanesInPattern(next, next.patterns[0], "track-1")[0].events).toEqual([{ position: 0, value: 0.2 }]);
    expect(lanesInPattern(next, next.patterns.find((p) => p.id === b), "track-1")).toEqual([]);
  });

  it("two patterns hold different curves for the same parameter", () => {
    let next = projectReducer(base, { ...point, patternId: a });
    next = projectReducer(next, { ...point, patternId: b, value: 0.9 });
    const value = (id: string) => projectInPattern(next, next.patterns.find((p) => p.id === id)).tracks[0].automation[0].events[0].value;
    expect([value(a), value(b)]).toEqual([0.2, 0.9]);
  });

  it("without a pattern the edit still goes to the track, and patterns fall back to it", () => {
    const next = projectReducer(base, point);
    expect(next.tracks[0].automation).toHaveLength(1);
    expect(lanesInPattern(next, next.patterns[0], "track-1")).toBe(next.tracks[0].automation);
  });

  it("the first edit starts from the track's lanes, and a reset falls back to them again", () => {
    let next = projectReducer(base, point);
    next = projectReducer(next, { ...point, patternId: a, position: 4, value: 0.8 });
    expect(lanesInPattern(next, next.patterns[0], "track-1")[0].events).toHaveLength(2);
    expect(next.tracks[0].automation[0].events).toHaveLength(1);
    next = projectReducer(next, { type: "RESET_PATTERN_AUTOMATION", patternId: a, target: "track-1" });
    expect(lanesInPattern(next, next.patterns[0], "track-1")).toBe(next.tracks[0].automation);
  });
});
