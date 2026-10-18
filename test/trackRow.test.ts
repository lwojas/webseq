import { describe, expect, it } from "vitest";
import { sameRow, type Props } from "../src/components/TrackRow";
import { createInitialProject } from "../src/model/project";

const noop = () => {};
const track = createInitialProject().tracks[0];
const base: Props = {
  index: 0,
  track,
  notes: [],
  beats: 16,
  beatsPerBar: 16,
  pxPerBeat: 28,
  visibleStart: 0,
  visibleEnd: 16,
  selected: false,
  selectedNoteId: null,
  onSelectNote: noop,
  onSelectTarget: noop,
  onAddNote: noop,
  onResizeNote: noop,
  onMoveNote: noop,
  onRemoveNote: noop,
  onSetMuted: noop,
  onSetSoloed: noop,
  looping: false,
  triggerDisabled: false,
  onTrigger: noop,
};

describe("TrackRow's memo comparator", () => {
  it("treats identical props as equal", () => {
    expect(sameRow(base, { ...base })).toBe(true);
  });

  it("re-renders when ANY prop other than track changes (guards a prop added without updating sameRow)", () => {
    const changed: Record<string, unknown> = {
      index: 1,
      notes: [],
      beats: 32,
      beatsPerBar: 8,
      pxPerBeat: 40,
      visibleStart: 4,
      visibleEnd: 8,
      selected: true,
      selectedNoteId: "n1",
      looping: true,
      triggerDisabled: true,
      onSelectNote: () => {},
      onSelectTarget: () => {},
      onAddNote: () => {},
      onResizeNote: () => {},
      onMoveNote: () => {},
      onRemoveNote: () => {},
      onSetMuted: () => {},
      onSetSoloed: () => {},
      onTrigger: () => {},
    };
    for (const key of Object.keys(base).filter((k) => k !== "track")) {
      expect(key in changed, `add a changed value for new prop "${key}" to this test`).toBe(true);
      expect(sameRow(base, { ...base, [key]: changed[key] } as Props), `changing ${key} must re-render`).toBe(false);
    }
  });

  it("re-renders for the track fields the row displays", () => {
    expect(sameRow(base, { ...base, track: { ...track, muted: true } })).toBe(false);
    expect(sameRow(base, { ...base, track: { ...track, soloed: true } })).toBe(false);
    expect(sameRow(base, { ...base, track: { ...track, name: "Kick" } })).toBe(false);
    expect(sameRow(base, { ...base, track: { ...track, assetId: 3 } })).toBe(false);
    expect(sameRow(base, { ...base, track: { ...track, fx: [{ id: "f", type: "filter", enabled: true, params: {} }] } })).toBe(false);
  });

  it("does NOT re-render for track fields the row doesn't show (a fader drag)", () => {
    expect(sameRow(base, { ...base, track: { ...track, volume: 0.3 } })).toBe(true);
    expect(sameRow(base, { ...base, track: { ...track, pan: 0.5 } })).toBe(true);
  });
});
