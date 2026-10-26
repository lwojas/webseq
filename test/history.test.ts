import { describe, expect, it } from "vitest";
import { createInitialProject, BANK_SIZE } from "../src/model/project";
import { copyBank, copyFx, copyTrack } from "../src/model/edit";
import { createHistory, historyReducer, MAX_HISTORY, type History, type HistoryAction } from "../src/model/history";
import { notesForTrack } from "../src/model/types";

const run = (h: History, ...actions: HistoryAction[]) => actions.reduce(historyReducer, h);
const pid = (h: History) => h.present.patterns[0].id;
const seq = (h: History, t = "track-1") => notesForTrack(h.present.patterns[0], t).map((n) => [n.start, n.pitch, n.duration]);

function seeded(): History {
  let h = createHistory(createInitialProject());
  const p = pid(h);
  for (const start of [0, 4, 8]) h = run(h, { type: "ADD_NOTE", patternId: p, trackId: "track-1", start });
  return h;
}

describe("history", () => {
  it("undo then redo restores each state", () => {
    const h0 = seeded();
    const before = seq(h0);
    const cleared = run(h0, { type: "CLEAR_TRACK_NOTES", patternId: pid(h0), trackId: "track-1" });
    expect(seq(cleared)).toEqual([]);
    const undone = run(cleared, { type: "UNDO" });
    expect(seq(undone)).toEqual(before);
    expect(run(undone, { type: "REDO" }).present.patterns[0].notes).toEqual(cleared.present.patterns[0].notes);
  });

  it("clear → undo returns the exact previous sequence (same note objects and ids)", () => {
    const h0 = seeded();
    const undone = run(h0, { type: "CLEAR_TRACK_NOTES", patternId: pid(h0), trackId: "track-1" }, { type: "UNDO" });
    expect(undone.present.patterns[0].notes).toEqual(h0.present.patterns[0].notes);
  });

  it("a new edit after undo discards the redo branch", () => {
    const h0 = seeded();
    const h = run(h0, { type: "CLEAR_TRACK_NOTES", patternId: pid(h0), trackId: "track-1" }, { type: "UNDO" });
    expect(h.future).toHaveLength(1);
    const edited = run(h, { type: "ADD_NOTE", patternId: pid(h), trackId: "track-2", start: 0 });
    expect(edited.future).toHaveLength(0);
    expect(run(edited, { type: "REDO" })).toBe(edited);
  });

  it("clearing an already-empty track records nothing", () => {
    const h0 = seeded();
    const h = run(h0, { type: "CLEAR_TRACK_NOTES", patternId: pid(h0), trackId: "track-5" });
    expect(h.past).toBe(h0.past);
    expect(h.past).toHaveLength(3);
    expect(h.present.patterns[0]).toBe(h0.present.patterns[0]);
  });

  it("undo/redo with nothing to do is a no-op", () => {
    const h = createHistory(createInitialProject());
    expect(run(h, { type: "UNDO" })).toBe(h);
    expect(run(h, { type: "REDO" })).toBe(h);
  });

  it("clear keeps track config; undo does not revert unrelated later changes", () => {
    let h = seeded();
    h = run(h, { type: "ADD_FX", target: "track-1", fxType: "filter" });
    const tracksBefore = h.present.tracks;
    const cleared = run(h, { type: "CLEAR_TRACK_NOTES", patternId: pid(h), trackId: "track-1" });
    expect(cleared.present.tracks).toBe(tracksBefore); // clear never touches tracks
    // mixer + bpm + rename after the clear are not undoable and must survive its undo
    const later = run(cleared, { type: "SET_TRACK_VOLUME", trackId: "track-1", volume: 0.3 }, { type: "SET_BPM", bpm: 90 }, { type: "RENAME_PATTERN", patternId: pid(h), name: "Verse" });
    const undone = run(later, { type: "UNDO" });
    expect(seq(undone)).toHaveLength(3);
    expect(undone.present.tracks[0].volume).toBe(0.3);
    expect(undone.present.tracks[0].fx).toHaveLength(1);
    expect(undone.present.bpm).toBe(90);
    expect(undone.present.patterns[0].name).toBe("Verse");
  });

  it("covers duplicate / extend / paste / pattern length", () => {
    const base = seeded();
    const h0 = run(base, { type: "SET_PATTERN_BARS", patternId: pid(base), bars: 4 });
    const p = pid(h0);
    for (const action of [
      { type: "DUPLICATE_SEQUENCE", patternId: p },
      { type: "DUPLICATE_BAR", patternId: p, bar: 0 },
      { type: "EXTEND_TRACK", patternId: p, trackId: "track-1" },
      { type: "SET_PATTERN_BARS", patternId: p, bars: 2 },
      { type: "PASTE_NOTES", patternId: p, trackId: "track-2", notes: [{ start: 0, duration: 1, velocity: 1, pitch: 60 }] },
      { type: "PASTE_TRACK", patternId: p, trackId: "track-3", clip: copyTrack(h0.present, "track-1", p)! },
      { type: "PASTE_BANK", bank: 1, clip: copyBank(h0.present, 0) },
    ] as HistoryAction[]) {
      const after = run(h0, action);
      expect(after.present).not.toBe(h0.present);
      expect(after.past).toHaveLength(h0.past.length + 1);
      const undone = run(after, { type: "UNDO" });
      expect(undone.present).toEqual(h0.present);
      expect(run(undone, { type: "REDO" }).present).toEqual(after.present);
    }
  });

  it("paste FX is undoable and only restores that track's changed fields", () => {
    let h = seeded();
    h = run(h, { type: "ADD_FX", target: "track-1", fxType: "filter" });
    const clip = copyFx(h.present.tracks[0]);
    const pasted = run(h, { type: "PASTE_FX", trackId: "track-2", clip });
    expect(pasted.present.tracks[1].fx.length).toBe(1);
    const undone = run(pasted, { type: "UNDO" });
    expect(undone.present.tracks[1].fx.length).toBe(0);
  });

  it("repeated drag edits on one note fold into a single step; other edits break the run", () => {
    const h0 = seeded();
    const p = pid(h0);
    const note = Object.values(h0.present.patterns[0].notes)[0];
    let h = run(h0, { type: "MOVE_NOTE", patternId: p, noteId: note.id, start: 1 }, { type: "MOVE_NOTE", patternId: p, noteId: note.id, start: 2 }, { type: "MOVE_NOTE", patternId: p, noteId: note.id, start: 3 });
    expect(h.past).toHaveLength(h0.past.length + 1);
    expect(run(h, { type: "UNDO" }).present.patterns[0].notes).toEqual(h0.present.patterns[0].notes);
    h = run(h, { type: "ADD_NOTE", patternId: p, trackId: "track-2", start: 0 }, { type: "MOVE_NOTE", patternId: p, noteId: note.id, start: 5 });
    expect(h.past).toHaveLength(h0.past.length + 3);
  });

  it("is bounded", () => {
    let h = createHistory(createInitialProject());
    const p = pid(h);
    for (let i = 0; i < MAX_HISTORY + 20; i++) h = run(h, { type: "ADD_NOTE", patternId: p, trackId: "track-1", start: i % 16 }, { type: "CLEAR_TRACK_NOTES", patternId: p, trackId: "track-1" });
    expect(h.past.length).toBe(MAX_HISTORY);
  });

  it("works across patterns and banks: undo targets the pattern/track the edit touched", () => {
    let h = createHistory(createInitialProject());
    h = run(h, { type: "ADD_PATTERN" });
    const [p1, p2] = h.present.patterns.map((p) => p.id);
    const bankTrack = h.present.tracks[BANK_SIZE]?.id ?? "track-1";
    h = run(h, { type: "ADD_NOTE", patternId: p1, trackId: "track-1", start: 0 }, { type: "ADD_NOTE", patternId: p2, trackId: bankTrack, start: 0 });
    h = run(h, { type: "UNDO" });
    expect(Object.keys(h.present.patterns[0].notes)).toHaveLength(1);
    expect(Object.keys(h.present.patterns[1].notes)).toHaveLength(0);
  });

  it("LOAD_PROJECT starts a fresh history", () => {
    const h = run(seeded(), { type: "LOAD_PROJECT", project: createInitialProject() });
    expect(h.past).toHaveLength(0);
    expect(h.future).toHaveLength(0);
  });

  it("undoable actions only ever change patterns and tracks (assets, queue, bpm stay out of patches)", () => {
    const h0 = seeded();
    const p = pid(h0);
    const after = run(h0, { type: "DUPLICATE_SEQUENCE", patternId: p }, { type: "PASTE_BANK", bank: 1, clip: copyBank(h0.present, 0) }).present;
    for (const k of ["bpm", "swing", "assets", "patternChain", "master", "beatsPerBar"] as const) expect(after[k]).toBe(h0.present[k]);
  });
});
