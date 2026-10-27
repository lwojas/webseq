import { describe, expect, it } from "vitest";
import { addNote } from "../src/model/notes";
import {
  addBlankSequence,
  addLane,
  addPatternToComposer,
  allSequences,
  canInsertAt,
  canPlace,
  composerLanes,
  copySequence,
  describeSongPosition,
  duplicateSequence,
  firstFreeStart,
  laneOfSequence,
  applyLaneModifiers,
  automationAppliesTo,
  automationSpans,
  describeModifiers,
  laneModifiers,
  masterLaneIndex,
  setLaneModifiers,
  launcherPatterns,
  migrateComposer,
  moveLane,
  moveSequence,
  pasteSequence,
  removeLane,
  removeSequence,
  renameLane,
  resizeSequence,
  sequenceBars,
  sequenceForPattern,
  setSequenceColor,
  songBeats,
  songInstances,
} from "../src/model/composer";
import { projectReducer } from "../src/model/reducer";
import { addPattern, createInitialProject, removePattern, setPatternBars } from "../src/model/project";
import { createHistory, historyReducer } from "../src/model/history";
import { fxOwner } from "../src/model/types";
import { parseProjectFile, serializeProjectFile } from "../src/persistence/projectFile";
import type { Project } from "../src/model/types";

const laneIds = (p: Project) => composerLanes(p).map((l) => l.id);
const seqs = (p: Project, lane = 0) => composerLanes(p)[lane].sequences;
const patternOf = (p: Project, seqId: string) => p.patterns.find((x) => x.id === allSequences(p).find((e) => e.seq.id === seqId)!.seq.patternId)!;

/** Launcher pattern A has a note; it is copied onto lane 1 twice (bars 0 and 1). */
function twoCopies(): Project {
  let p = createInitialProject("t", 4);
  p = { ...p, patterns: [addNote(p.patterns[0], p.beatsPerBar, "track-1", 0, 2, 1)] };
  p = addPatternToComposer(p, p.patterns[0].id);
  return duplicateSequence(p, seqs(p)[0].id);
}

describe("sequences are independent instances", () => {
  it("copies a launcher pattern without touching the launcher", () => {
    const p = twoCopies();
    expect(launcherPatterns(p.patterns)).toHaveLength(1);
    expect(allSequences(p)).toHaveLength(2);
    expect(seqs(p)[0].patternId).not.toBe(seqs(p)[1].patternId);
    expect(Object.keys(patternOf(p, seqs(p)[1].id).notes)).toHaveLength(1);
  });

  it("editing one sequence's pattern leaves the other (and the source) unchanged", () => {
    const p = twoCopies();
    const edited = projectReducer(p, { type: "ADD_NOTE", patternId: seqs(p)[1].patternId, trackId: "track-1", start: 8 });
    expect(Object.keys(patternOf(edited, seqs(p)[1].id).notes)).toHaveLength(2);
    expect(Object.keys(patternOf(edited, seqs(p)[0].id).notes)).toHaveLength(1);
    expect(edited.patterns[0]).toBe(p.patterns[0]);
  });

  it("colour belongs to the instance", () => {
    let p = twoCopies();
    const [a, b] = seqs(p);
    p = setSequenceColor(p, b.id, "#112233");
    expect(seqs(p)[0].color).toBe(a.color);
    expect(seqs(p)[1].color).toBe("#112233");
  });

  it("keeps Composer patterns after launcher patterns, so launcher indices are stable", () => {
    const p = addPattern(twoCopies());
    expect(p.patterns.map((x) => !!x.composerOwned)).toEqual([false, false, true, true]);
  });
});

describe("lanes", () => {
  it("the first sequence creates the first lane; lanes are added, renamed and reordered", () => {
    let p = twoCopies();
    expect(composerLanes(p).map((l) => l.name)).toEqual(["Lane 1"]);
    p = renameLane(addLane(addLane(p), "Bass"), laneIds(p)[0], "Drums");
    expect(composerLanes(p).map((l) => l.name)).toEqual(["Drums", "Lane 2", "Bass"]);
    p = moveLane(p, laneIds(p)[2], 0);
    expect(composerLanes(p).map((l) => l.name)).toEqual(["Bass", "Drums", "Lane 2"]);
    expect(moveLane(p, laneIds(p)[0], 0)).toBe(p);
  });

  it("sequences on different lanes may overlap in time; on one lane they may not", () => {
    let p = addLane(twoCopies());
    const [l1, l2] = laneIds(p);
    expect(canPlace(p, l1, 0, 1)).toBe(false);
    expect(canPlace(p, l2, 0, 2)).toBe(true);
    p = addBlankSequence(p, l2);
    expect(seqs(p, 1)[0].start).toBe(0); // same time as lane 1's first sequence
    expect(moveSequence(p, seqs(p)[1].id, 0)).toBe(p); // onto its neighbour on its own lane
  });

  it("moves a sequence to another lane, rejecting a clash there", () => {
    let p = addLane(twoCopies());
    const [l1, l2] = laneIds(p);
    p = addBlankSequence(p, l2);
    const mover = seqs(p)[1].id; // lane 1, bar 1
    expect(moveSequence(p, mover, 0, l2)).toBe(p); // lane 2 has a sequence at bar 0
    p = moveSequence(p, mover, 3, l2);
    expect(laneOfSequence(p, mover)!.id).toBe(l2);
    expect(seqs(p, 0).map((s) => s.id)).not.toContain(mover);
    expect(seqs(p, 1).map((s) => s.start)).toEqual([0, 3]);
    expect(l1).not.toBe(l2);
  });

  it("firstFreeStart and paste work per lane", () => {
    const p = addLane(twoCopies());
    const [l1, l2] = laneIds(p);
    expect(firstFreeStart(p, l1, 1, 0)).toBe(2);
    expect(firstFreeStart(p, l2, 1, 0)).toBe(0);
    const clip = copySequence(p, seqs(p)[0].id)!;
    expect(seqs(pasteSequence(p, clip, l2, 0), 1)[0].start).toBe(0);
    expect(seqs(pasteSequence(p, clip, l1, 0), 0)[2].start).toBe(2);
  });

  it("removing a lane removes its sequences' patterns", () => {
    let p = twoCopies();
    p = removeLane(p, laneIds(p)[0]);
    expect(composerLanes(p)).toEqual([]);
    expect(p.patterns.filter((x) => x.composerOwned)).toHaveLength(0);
    expect(launcherPatterns(p.patterns)).toHaveLength(1);
  });
});

describe("lane modifiers are musical, not audio", () => {
  const patternWith = () => {
    let p = twoCopies();
    p = projectReducer(p, { type: "ADD_NOTE", patternId: seqs(p)[0].patternId, trackId: "track-1", start: 4 });
    return patternOf(p, seqs(p)[0].id);
  };

  it("a lane has no audio state: no FX, automation, tracks or bus", () => {
    const lane = composerLanes(twoCopies())[0];
    expect(Object.keys(lane).sort()).toEqual(["id", "name", "sequences"]);
  });

  it("are set, clamped, and stored only when they differ from default", () => {
    let p = twoCopies();
    const id = laneIds(p)[0];
    p = setLaneModifiers(p, id, { transpose: 40, velocity: 9, gate: 0 });
    expect(laneModifiers(composerLanes(p)[0])).toEqual({ transpose: 24, velocity: 2, gate: 0.25 });
    expect(describeModifiers(laneModifiers(composerLanes(p)[0]))).toBe("+24 st · vel 200% · gate 25%");
    p = setLaneModifiers(p, id, { transpose: 0, velocity: 1, gate: 1 });
    expect(composerLanes(p)[0].modifiers).toBeUndefined();
    expect(setLaneModifiers(p, id, { transpose: 0 })).toBe(p);
  });

  it("transpose, velocity and gate rewrite the notes a lane plays, leaving the stored pattern alone", () => {
    const pattern = patternWith();
    const played = applyLaneModifiers(pattern, { transpose: 7, velocity: 0.5, gate: 2 });
    const orig = Object.values(pattern.notes);
    const mod = Object.values(played.notes);
    expect(mod.map((n) => n.pitch)).toEqual(orig.map(() => 7));
    expect(mod.map((n) => n.velocity)).toEqual(orig.map((n) => n.velocity * 0.5));
    expect(mod.map((n) => n.duration)).toEqual(orig.map((n) => n.duration * 2));
    expect(orig.every((n) => n.pitch === undefined)).toBe(true);
    expect(applyLaneModifiers(pattern, { transpose: 0, velocity: 1, gate: 1 })).toBe(pattern);
  });

  it("transpose adds to an existing pitch and keeps chords as written", () => {
    const base = patternWith();
    const [a, b] = Object.values(base.notes);
    const pattern = { ...base, notes: { [a.id]: { ...a, pitch: 3 }, [b.id]: { ...b, chord: { root: 0, degrees: [0, 2, 4] } } } };
    const played = applyLaneModifiers(pattern, { transpose: -3, velocity: 1, gate: 1 });
    expect(played.notes[a.id].pitch).toBeUndefined(); // 3 - 3 = 0: back to the track's own pitch
    expect(played.notes[b.id].pitch).toBeUndefined();
    expect(played.notes[b.id].chord).toEqual({ root: 0, degrees: [0, 2, 4] });
  });
});

describe("no overlap within a lane", () => {
  it("places new sequences after the last one", () => {
    const p = addBlankSequence(twoCopies());
    expect(seqs(p).map((s) => s.start)).toEqual([0, 1, 2]);
  });

  it("rejects bad moves and leaves the project untouched", () => {
    const p = twoCopies();
    const id = seqs(p)[1].id;
    expect(moveSequence(p, id, 0)).toBe(p);
    expect(moveSequence(p, id, -1)).toBe(p);
    expect(moveSequence(p, id, 3.5)).toBe(p);
    expect(seqs(moveSequence(p, id, 5))[1].start).toBe(5);
  });

  it("resize stops at the next sequence, and so does the sequencer's bars stepper", () => {
    const p = twoCopies();
    expect(resizeSequence(p, seqs(p)[0].id, 2)).toBe(p);
    const grown = resizeSequence(p, seqs(p)[1].id, 3);
    expect(sequenceBars(grown, seqs(grown)[1])).toBe(3);
    expect(setPatternBars(p, seqs(p)[0].patternId, 2)).toBe(p);
    expect(setPatternBars(p, seqs(p)[1].patternId, 4)).not.toBe(p);
  });

  it("shrinking drops notes past the new end, like the sequencer", () => {
    let p = twoCopies();
    const id = seqs(p)[1].id;
    p = resizeSequence(p, id, 2);
    p = projectReducer(p, { type: "ADD_NOTE", patternId: seqs(p)[1].patternId, trackId: "track-1", start: 20 });
    expect(Object.keys(patternOf(p, id).notes)).toHaveLength(3); // the original, its repeat in bar 2, and the new one
    p = resizeSequence(p, id, 1);
    expect(Object.keys(patternOf(p, id).notes)).toHaveLength(1);
  });

  it("growing a sequence repeats its own content into the new bars", () => {
    let p = twoCopies(); // each sequence is 1 bar with a 2-step note on beat 0 of track-1
    const id = seqs(p)[1].id;
    p = resizeSequence(p, id, 3);
    const notes = Object.values(patternOf(p, id).notes).sort((a, b) => a.start - b.start);
    expect(notes.map((n) => n.start)).toEqual([0, 16, 32]);
    expect(notes.map((n) => n.duration)).toEqual([2, 2, 2]);
    expect(new Set(notes.map((n) => n.id)).size).toBe(3); // fresh ids
    expect(Object.keys(patternOf(p, seqs(p)[0].id).notes)).toHaveLength(1); // the other sequence is untouched
  });

  it("a partial repeat takes only what starts inside the new bars", () => {
    let p = twoCopies();
    const id = seqs(p)[1].id;
    p = projectReducer(p, { type: "ADD_NOTE", patternId: seqs(p)[1].patternId, trackId: "track-1", start: 12 }); // 1 bar: notes at 0 and 12
    p = resizeSequence(p, id, 2); // bar 2 = a copy of bar 1
    p = moveSequence(p, id, 4);
    p = resizeSequence(p, id, 3); // 2 -> 3: the new bar repeats the content's first bar only
    const starts = Object.values(patternOf(p, id).notes).map((n) => n.start).sort((a, b) => a - b);
    expect(starts).toEqual([0, 12, 16, 28, 32, 44]);
  });
});

describe("inserting at a marker", () => {
  it("canInsertAt allows a free bar or the end of a sequence, and refuses a bar inside one or too little room", () => {
    let p = twoCopies(); // sequences at bars 0 and 1
    const lane = laneIds(p)[0];
    expect(canInsertAt(p, lane, 2, 1)).toBe(true); // the end
    expect(canInsertAt(p, lane, 1, 1)).toBe(false); // on a sequence
    p = moveSequence(p, seqs(p)[1].id, 4);
    expect(canInsertAt(p, lane, 1, 3)).toBe(true); // the gap is 3 bars
    expect(canInsertAt(p, lane, 1, 4)).toBe(false); // too long for it
    expect(canInsertAt(createInitialProject(), null, 0, 1)).toBe(true); // no lane yet: one is made
  });

  it("adds a blank sequence, a launcher pattern and a paste exactly at the marker, or not at all", () => {
    let p = twoCopies();
    p = moveSequence(p, seqs(p)[1].id, 4);
    const lane = laneIds(p)[0];
    const blank = addBlankSequence(p, lane, 2);
    expect(seqs(blank).map((s) => s.start)).toEqual([0, 2, 4]);
    expect(addBlankSequence(p, lane, 0)).toEqual(p); // bar 1 holds a sequence: refused, nothing added
    const viaPattern = addPatternToComposer(p, p.patterns[0].id, lane, 3);
    expect(seqs(viaPattern).map((s) => s.start)).toEqual([0, 3, 4]);
    const clip = copySequence(p, seqs(p)[0].id)!;
    expect(seqs(pasteSequence(p, clip, lane, 2, true)).map((s) => s.start)).toEqual([0, 2, 4]);
    expect(pasteSequence(p, clip, lane, 0, true)).toEqual(p); // exact: no sliding to a free slot
    expect(seqs(pasteSequence(p, clip, lane, 0)).map((s) => s.start)).toEqual([0, 1, 4]); // not exact: first free slot
  });
});

describe("duplicate / copy / paste / remove", () => {
  it("duplicate lands after the original on its lane and is independent", () => {
    const q = twoCopies();
    const d = duplicateSequence(q, seqs(q)[0].id);
    expect(seqs(d).map((s) => s.start)).toEqual([0, 1, 2]);
    expect(new Set(seqs(d).map((s) => s.patternId)).size).toBe(3);
  });

  it("paste is independent even after the source is deleted", () => {
    let p = twoCopies();
    const first = seqs(p)[0];
    const clip = copySequence(p, first.id)!;
    p = removeSequence(p, first.id);
    p = pasteSequence(p, clip, laneIds(p)[0], 0);
    expect(seqs(p)).toHaveLength(2);
    expect(Object.keys(patternOf(p, seqs(p)[0].id).notes)).toHaveLength(1);
  });

  it("removing a sequence removes its pattern only", () => {
    const p = twoCopies();
    const gone = seqs(p)[0].patternId;
    const q = removeSequence(p, seqs(p)[0].id);
    expect(q.patterns.some((x) => x.id === gone)).toBe(false);
    expect(sequenceForPattern(q, gone)).toBeUndefined();
  });

  it("the launcher cannot delete or fall back to a Composer pattern", () => {
    const p = twoCopies();
    expect(removePattern(p, seqs(p)[0].patternId)).toBe(p);
    expect(removePattern(p, p.patterns[0].id)).toBe(p);
    const two = addPattern(p);
    const q = removePattern(two, two.patterns[0].id);
    expect(q.patternChain.every((e) => !q.patterns.find((x) => x.id === e.patternId)?.composerOwned)).toBe(true);
  });
});

describe("the song", () => {
  /** lane 1: sequences at bars 0 and 2; lane 2: one at bar 1 (2 bars). */
  function song(): Project {
    let p = twoCopies();
    p = moveSequence(p, seqs(p)[1].id, 2);
    p = addLane(p);
    p = addBlankSequence(p, laneIds(p)[1]);
    p = moveSequence(p, seqs(p, 1)[0].id, 1);
    return resizeSequence(p, seqs(p, 1)[0].id, 2);
  }

  it("lists every lane's sequences at their positions, overlapping across lanes, in play order", () => {
    const p = song();
    expect(songInstances(p).map((i) => [i.laneIndex, i.startBeat / 16, i.beats / 16])).toEqual([
      [0, 0, 1],
      [1, 1, 2],
      [0, 2, 1],
    ]);
    expect(songBeats(p)).toBe(3 * 16);
  });

  it("an empty song has no length", () => {
    expect(songInstances(createInitialProject())).toEqual([]);
    expect(songBeats(createInitialProject())).toBe(0);
  });

  it("existing track automation applies to the sequences that have notes for the track", () => {
    const p = song();
    expect(automationSpans(p, "track-1").map((x) => x.startBeat / 16)).toEqual([0, 2]); // lane 2's sequence has the same notes but overlaps
    expect(automationSpans(p, "track-9")).toEqual([]);
    const inst = songInstances(p);
    expect(automationAppliesTo(inst[0], "master", masterLaneIndex(inst))).toBe(true);
    expect(automationAppliesTo(inst[1], "master", masterLaneIndex(inst))).toBe(false); // lane 2: the top lane carries the master's
  });

  it("describes what sounds on all lanes and when it changes", () => {
    const p = song();
    expect(describeSongPosition(p, 0)).toBe("Pattern A · bar 1 · change in 1 bar");
    expect(describeSongPosition(p, 2 * 16 + 4)).toBe("Sequence 3 + Pattern A · bar 3 · change in 0.8 bars"); // earliest start first
  });
});

describe("reducer, history, persistence", () => {
  it("a sequence resize is undoable", () => {
    let h = createHistory(twoCopies());
    const last = seqs(h.present)[1];
    h = historyReducer(h, { type: "COMPOSER_RESIZE", sequenceId: last.id, bars: 3 });
    expect(sequenceBars(h.present, seqs(h.present)[1])).toBe(3);
    h = historyReducer(h, { type: "UNDO" });
    expect(sequenceBars(h.present, seqs(h.present)[1])).toBe(1);
  });

  describe("undo / redo of arrangement edits", () => {
    const apply = (h: ReturnType<typeof createHistory>, ...actions: Parameters<typeof historyReducer>[1][]) => actions.reduce(historyReducer, h);
    const undo = (h: ReturnType<typeof createHistory>) => historyReducer(h, { type: "UNDO" });
    const redo = (h: ReturnType<typeof createHistory>) => historyReducer(h, { type: "REDO" });

    it("duplicate: undo removes the copy and its pattern, redo brings both back", () => {
      let h = createHistory(twoCopies());
      const before = h.present;
      h = apply(h, { type: "COMPOSER_DUPLICATE", sequenceId: seqs(h.present)[0].id });
      expect(seqs(h.present)).toHaveLength(3);
      const afterDup = h.present;
      h = undo(h);
      expect(h.present.composer).toBe(before.composer);
      expect(h.present.patterns).toHaveLength(before.patterns.length);
      h = redo(h);
      expect(seqs(h.present).map((x) => x.id)).toEqual(seqs(afterDup).map((x) => x.id));
      expect(h.present.patterns.map((x) => x.id).sort()).toEqual(afterDup.patterns.map((x) => x.id).sort());
    });

    it("paste, delete, move, colour, add lane, lane modifiers, remove lane are each one undoable step", () => {
      let h = createHistory(twoCopies());
      const clip = copySequence(h.present, seqs(h.present)[0].id)!;
      const steps: Parameters<typeof historyReducer>[1][] = [
        { type: "COMPOSER_PASTE", clip, laneId: laneIds(h.present)[0], at: 5, exact: true },
        { type: "COMPOSER_MOVE", sequenceId: seqs(h.present)[1].id, start: 8 },
        { type: "COMPOSER_SET_COLOR", sequenceId: seqs(h.present)[0].id, color: "#000000" },
        { type: "COMPOSER_REMOVE", sequenceId: seqs(h.present)[0].id },
        { type: "COMPOSER_ADD_LANE", name: "Bass" },
      ];
      const states = [h.present];
      for (const a of steps) {
        h = apply(h, a);
        states.push(h.present);
      }
      h = apply(h, { type: "COMPOSER_SET_LANE_MODIFIERS", laneId: laneIds(h.present)[1], patch: { transpose: 5 } });
      states.push(h.present);
      h = apply(h, { type: "COMPOSER_REMOVE_LANE", laneId: laneIds(h.present)[1] });
      states.push(h.present);
      for (let i = states.length - 2; i >= 0; i--) {
        h = undo(h);
        expect(h.present.composer).toBe(states[i].composer);
        expect(h.present.patterns.map((x) => x.id).sort()).toEqual(states[i].patterns.map((x) => x.id).sort());
      }
      expect(h.past).toHaveLength(0);
      for (let i = 1; i < states.length; i++) {
        h = redo(h);
        expect(h.present.composer).toEqual(states[i].composer);
      }
    });

    it("undoing an arrangement edit leaves note edits made to other sequences since", () => {
      let h = createHistory(twoCopies());
      h = apply(h, { type: "COMPOSER_DUPLICATE", sequenceId: seqs(h.present)[0].id });
      const other = seqs(h.present)[1].patternId;
      h = apply(h, { type: "ADD_NOTE", patternId: other, trackId: "track-1", start: 8 });
      h = undo(h); // the note
      h = undo(h); // the duplicate
      expect(seqs(h.present)).toHaveLength(2);
      expect(Object.keys(h.present.patterns.find((x) => x.id === other)!.notes)).toHaveLength(1);
    });

    it("a lane name typed in is one step", () => {
      let h = apply(createHistory(twoCopies()), { type: "COMPOSER_RENAME_LANE", laneId: laneIds(twoCopies())[0], name: "x" });
      expect(h.past.length).toBe(0); // a different project's lane id: nothing happened
      const base = createHistory(twoCopies());
      const id = laneIds(base.present)[0];
      h = apply(base, { type: "COMPOSER_RENAME_LANE", laneId: id, name: "D" }, { type: "COMPOSER_RENAME_LANE", laneId: id, name: "Dr" }, { type: "COMPOSER_RENAME_LANE", laneId: id, name: "Drums" });
      expect(h.past).toHaveLength(1);
      expect(composerLanes(undo(h).present)[0].name).toBe("Lane 1");
    });
  });

  it("round-trips lanes and their modifiers through a project file", () => {
    let p = addLane(twoCopies(), "Bass");
    p = setLaneModifiers(p, laneIds(p)[1], { transpose: 7, velocity: 0.8 });
    const back = parseProjectFile(serializeProjectFile(p, new Map())).project;
    expect(back.composer).toEqual(p.composer);
  });

  it("drops the audio fields an earlier lane version stored (tracks, FX, automation) on load", () => {
    const p = twoCopies();
    const old = { ...p, composer: { lanes: [{ ...composerLanes(p)[0], trackIds: ["track-1"], fx: [{ id: "x" }], automation: [] }] } } as unknown as Project;
    const loaded = projectReducer(createInitialProject(), { type: "LOAD_PROJECT", project: old });
    expect(Object.keys(composerLanes(loaded)[0]).sort()).toEqual(["id", "name", "sequences"]);
    expect(composerLanes(loaded)[0].sequences).toEqual(seqs(p));
  });

  it("brings a single-timeline Composer project up to one lane on load", () => {
    const p = twoCopies();
    const legacy = { ...p, composer: { sequences: seqs(p) } } as unknown as Project;
    const loaded = projectReducer(createInitialProject(), { type: "LOAD_PROJECT", project: legacy });
    expect(composerLanes(loaded)).toHaveLength(1);
    expect(composerLanes(loaded)[0].sequences).toEqual(seqs(p));
    expect(migrateComposer(p)).toBe(p);
  });

  it("a project without a composer behaves as before", () => {
    const p = createInitialProject("t", 2);
    expect(composerLanes(p)).toEqual([]);
    expect(p.composer).toBeUndefined();
    expect(fxOwner(p, "no-such-target")).toBeNull(); // lanes are not FX targets: only a track or the master is
  });
});
