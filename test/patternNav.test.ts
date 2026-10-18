import { describe, expect, it } from "vitest";
import { adjacentPatternId } from "../src/model/patternNav";
import type { Pattern } from "../src/model/types";

const patterns = ["a", "b", "c"].map((id) => ({ id, name: id, bars: 1, notes: {} }) as unknown as Pattern);

describe("adjacentPatternId", () => {
  it("steps forward and back", () => {
    expect(adjacentPatternId(patterns, "b", 1)).toBe("c");
    expect(adjacentPatternId(patterns, "b", -1)).toBe("a");
  });
  it("stops at either end instead of wrapping", () => {
    expect(adjacentPatternId(patterns, "a", -1)).toBe("a");
    expect(adjacentPatternId(patterns, "c", 1)).toBe("c");
  });
  it("falls back to the first pattern for an unknown id", () => {
    expect(adjacentPatternId(patterns, "zzz", 1)).toBe("a");
  });
});
