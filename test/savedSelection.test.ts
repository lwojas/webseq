import { describe, expect, it } from "vitest";
import { preselectSavedProject } from "../src/persistence/savedSelection";

const saved = [{ id: "a" }, { id: "b" }];

describe("preselectSavedProject", () => {
  it("selects the saved project that is the one open", () => {
    expect(preselectSavedProject("", "b", saved)).toBe("b");
  });

  it("does nothing when the open project is not a saved one (a new or imported project)", () => {
    expect(preselectSavedProject("", "new-one", saved)).toBe("");
    expect(preselectSavedProject("", "b", [])).toBe("");
  });

  it("never overrides a selection already made", () => {
    expect(preselectSavedProject("a", "b", saved)).toBe("a");
    expect(preselectSavedProject("a", "a", saved)).toBe("a");
  });
});
