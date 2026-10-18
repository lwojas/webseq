import { describe, expect, it } from "vitest";
import { deriveLayout, dockLabel, effectiveSideView, PHONE_QUERY, type LayoutState } from "../src/app/layout";

const base: LayoutState = { mobileTab: "timeline", mainView: "sequencer", takeover: "none", bottomPanelView: "instrument", trackSubTab: "instrument", libraryView: "assets" };
const desktop = { isPhone: false };
const phone = { isPhone: true };

describe("breakpoints", () => {
  it("the phone breakpoint in JS matches index.css's @media block", async () => {
    // Vitest stubs CSS imports (even ?raw) to an empty string, so read the file directly. Node's
    // types aren't a dependency of this project; vitest itself runs in Node.
    // @ts-expect-error no @types/node
    const { readFileSync } = await import("node:fs");
    const indexCss: string = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    const px = PHONE_QUERY.match(/max-width:\s*(\d+)px/)![1];
    expect(indexCss).toContain(`@media (max-width: ${px}px)`);
  });
});

describe("deriveLayout", () => {
  it("shows the timeline only when nothing takes its place", () => {
    expect(deriveLayout(desktop, base).timelineVisible).toBe(true);
    expect(deriveLayout(phone, { ...base, takeover: "picker" }).timelineVisible).toBe(false);
    expect(deriveLayout(desktop, { ...base, mainView: "patterns" }).timelineVisible).toBe(false);
    expect(deriveLayout(phone, { ...base, mobileTab: "track" }).timelineVisible).toBe(false);
  });
  it("takeovers (picker, settings) exist only on a phone's Timeline tab", () => {
    expect(deriveLayout(desktop, { ...base, takeover: "settings" }).takeover).toBe("none");
    expect(deriveLayout(desktop, { ...base, takeover: "picker" }).takeover).toBe("none");
    expect(deriveLayout(phone, { ...base, takeover: "settings" }).takeover).toBe("settings");
    expect(deriveLayout(phone, { ...base, takeover: "picker" }).takeover).toBe("picker");
    expect(deriveLayout(phone, { ...base, mobileTab: "mixer", takeover: "settings" }).takeover).toBe("none");
  });
  it("offers the right dock tabs per breakpoint", () => {
    expect(deriveLayout(desktop, base).dockViews).toEqual(["instrument", "fx", "editor", "mixer"]);
    expect(deriveLayout(phone, base).dockViews).toEqual(["instrument", "fx", "editor", "edit"]);
    expect(deriveLayout(phone, { ...base, mobileTab: "mixer" }).dockViews).toEqual([]);
  });
  it("falls back to Instrument when the chosen desktop dock view isn't offered", () => {
    expect(deriveLayout(desktop, { ...base, bottomPanelView: "edit" }).activeDockView).toBe("instrument");
    expect(deriveLayout(desktop, { ...base, bottomPanelView: "mixer" }).activeDockView).toBe("mixer");
  });
  it("the Patterns page is visible on its desktop tab, or the phone Library's Patterns sub-tab", () => {
    expect(deriveLayout(desktop, base).patternsVisible).toBe(false);
    expect(deriveLayout(desktop, { ...base, mainView: "patterns" }).patternsVisible).toBe(true);
    expect(deriveLayout(phone, { ...base, mobileTab: "library", libraryView: "patterns" }).patternsVisible).toBe(true);
    expect(deriveLayout(phone, { ...base, mobileTab: "library", libraryView: "assets" }).patternsVisible).toBe(false);
    expect(deriveLayout(phone, { ...base, mainView: "patterns" }).patternsVisible).toBe(false);
  });
  it("a phone never shows the Edit side-panel view (it has an Edit sub-tab)", () => {
    expect(effectiveSideView(phone, "edit")).toBe("assets");
    expect(effectiveSideView(desktop, "edit")).toBe("edit");
    expect(effectiveSideView(phone, "midi")).toBe("midi");
  });
  it("on a phone the Track sub-tab or Mixer decides the panel", () => {
    expect(deriveLayout(phone, { ...base, mobileTab: "track", trackSubTab: "editor" }).activeDockView).toBe("editor");
    expect(deriveLayout(phone, { ...base, mobileTab: "mixer" }).activeDockView).toBe("mixer");
  });
  it("uses short tab labels on the phone", () => {
    expect(dockLabel("editor", true)).toBe("Notes");
    expect(dockLabel("editor", false)).toBe("Track Editor");
  });
});
