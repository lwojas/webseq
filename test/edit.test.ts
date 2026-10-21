import { describe, expect, it } from "vitest";
import { addFx } from "../src/model/fx";
import { setAutomationPoint } from "../src/model/automation";
import { addInstrumentLfo, setInstrumentParam, setTrackInstrument } from "../src/model/instruments";
import { setTrackEventLfo } from "../src/model/eventLfo";
import { addAsset, addNote, assignAsset, BANK_SIZE, createInitialProject, setPatternBars, setTrackVolume } from "../src/model/project";
import {
  canPasteSynthLfos, copyBank, copyFx, copyInstrument, copyModulation, copyTrack, duplicateBar, duplicateSequence, extendTrack,
  pasteBank, pasteFx, pasteInstrument, pasteModulation, pasteTrack,
} from "../src/model/edit";
import { projectReducer as reducer } from "../src/model/reducer";
import { notesForTrack } from "../src/model/types";
import type { Asset, Project } from "../src/model/types";

const asset: Asset = { id: 1, name: "kick.wav", type: "audio", duration: 1, sampleRate: 48000, channels: 2, origin: "import" };

function setup(): { project: Project; pid: string } {
  let project = addAsset(createInitialProject(), asset);
  const pid = project.patterns[0].id;
  project = assignAsset(project, "track-1", 1);
  project = addFx(project, "track-1", "filter");
  project = setAutomationPoint(project, "track-1", project.tracks[0].fx[0].id, "cutoff", 0, 500);
  project = addNote(project, pid, "track-1", 0);
  project = addNote(project, pid, "track-1", 4);
  return { project, pid };
}
const notes = (p: Project, pid: string, tid: string) => notesForTrack(p.patterns.find((x) => x.id === pid)!, tid);

describe("Track clip", () => {
  it("copies sequence + config to another track, with fresh ids and no shared references", () => {
    const { project, pid } = setup();
    const clip = copyTrack(project, "track-1", pid)!;
    const next = pasteTrack(project, "track-2", pid, clip);
    const [src, dest] = [next.tracks[0], next.tracks[1]];
    expect(dest.assetId).toBe(1);
    expect(dest.fx).toHaveLength(1);
    expect(dest.fx[0].id).not.toBe(src.fx[0].id);
    expect(dest.automation[0].fxId).toBe(dest.fx[0].id);
    expect(dest.fx[0].params).not.toBe(src.fx[0].params);
    expect(notes(next, pid, "track-2").map((n) => n.start)).toEqual([0, 4]);
    const ids = new Set(notes(next, pid, "track-1").map((n) => n.id));
    expect(notes(next, pid, "track-2").every((n) => !ids.has(n.id))).toBe(true);
  });

  it("works across banks, replaces the destination's notes, and keeps its mixer state", () => {
    let { project, pid } = setup();
    project = addNote(project, pid, "track-20", 8);
    project = setTrackVolume(project, "track-20", 0.5);
    const next = pasteTrack(project, "track-20", pid, copyTrack(project, "track-1", pid)!);
    expect(notes(next, pid, "track-20").map((n) => n.start)).toEqual([0, 4]);
    expect(next.tracks[19].volume).toBe(0.5);
  });

  it("is a snapshot: later edits to the source don't change what gets pasted", () => {
    const { project, pid } = setup();
    const clip = copyTrack(project, "track-1", pid)!;
    const edited = addFx(project, "track-1", "delay");
    expect(clip.config.fx).toHaveLength(1);
    expect(pasteTrack(edited, "track-2", pid, clip).tracks[1].fx).toHaveLength(1);
  });
});

describe("Instrument / FX / Modulation clips", () => {
  it("pasting an instrument leaves sequence, FX and modulation alone", () => {
    let { project, pid } = setup();
    project = setTrackInstrument(project, "track-2", "bass");
    project = setInstrumentParam(project, "track-2", "tune", 40);
    project = addNote(project, pid, "track-3", 0);
    project = addFx(project, "track-3", "delay");
    const next = pasteInstrument(project, "track-3", copyInstrument(project.tracks[1]));
    expect(next.tracks[2].instrument?.kind).toBe("bass");
    expect(next.tracks[2].instrument).not.toBe(project.tracks[1].instrument);
    expect(next.tracks[2].instrument?.params).not.toBe(project.tracks[1].instrument?.params);
    expect(next.tracks[2].fx).toHaveLength(1);
    expect(notes(next, pid, "track-3")).toHaveLength(1);
  });

  it("instrument copy of a sample track sets assetId and clears a synth", () => {
    let { project } = setup();
    project = setTrackInstrument(project, "track-2", "kick");
    const next = pasteInstrument(project, "track-2", copyInstrument(project.tracks[0]));
    expect(next.tracks[1].assetId).toBe(1);
    expect(next.tracks[1].instrument).toBeNull();
  });

  it("stale asset falls back to null", () => {
    const { project } = setup();
    const clip = copyInstrument(project.tracks[0]);
    expect(pasteInstrument(createInitialProject(), "track-2", clip).tracks[1].assetId).toBeNull();
  });

  it("pasting FX replaces the chain with fresh ids and remapped automation, touching nothing else", () => {
    const { project, pid } = setup();
    const next = pasteFx(project, "track-2", copyFx(project.tracks[0]));
    expect(next.tracks[1].fx[0].id).not.toBe(project.tracks[0].fx[0].id);
    expect(next.tracks[1].automation[0].fxId).toBe(next.tracks[1].fx[0].id);
    expect(next.tracks[1].automation[0].events).not.toBe(project.tracks[0].automation[0].events);
    expect(next.tracks[1].assetId).toBeNull();
    expect(notes(next, pid, "track-2")).toHaveLength(0);
  });

  it("pasting modulation copies LFO slots for the same synth and the event LFO always", () => {
    let { project } = setup();
    project = setTrackInstrument(project, "track-2", "bass");
    project = addInstrumentLfo(project, "track-2", "tune");
    project = setTrackEventLfo(project, "track-2", { enabled: true, depth: 0.5 });
    project = setTrackInstrument(project, "track-3", "bass");
    project = setTrackInstrument(project, "track-4", "kick");
    const clip = copyModulation(project.tracks[1]);
    const same = pasteModulation(project, "track-3", clip);
    expect(same.tracks[2].instrument?.lfos).toHaveLength(1);
    expect(same.tracks[2].instrument?.lfos?.[0]).not.toBe(project.tracks[1].instrument?.lfos?.[0]);
    expect(same.tracks[2].eventLfo?.depth).toBe(0.5);
    expect(canPasteSynthLfos(project.tracks[3], clip)).toBe(false);
    const other = pasteModulation(project, "track-4", clip);
    expect(other.tracks[3].instrument?.lfos).toBeUndefined();
    expect(other.tracks[3].eventLfo?.enabled).toBe(true);
  });
});

describe("Bank clip", () => {
  it("restores config and every pattern's notes onto another bank", () => {
    let { project, pid } = setup();
    project = { ...project, patterns: [...project.patterns, { id: "p2", name: "B", bars: 1, notes: {} }] };
    project = addNote(project, "p2", "track-2", 2);
    project = addNote(project, pid, "track-17", 12); // pre-existing content in bank B is replaced
    const next = pasteBank(project, 1, copyBank(project, 0));
    expect(next.tracks[BANK_SIZE].assetId).toBe(1);
    expect(next.tracks[BANK_SIZE].fx[0].id).not.toBe(project.tracks[0].fx[0].id);
    expect(notes(next, pid, "track-17").map((n) => n.start)).toEqual([0, 4]);
    expect(notes(next, "p2", "track-18").map((n) => n.start)).toEqual([2]);
    expect(notes(next, pid, "track-1")).toHaveLength(2); // source untouched
  });
});

describe("Bar Tools", () => {
  function twoBars() {
    let { project, pid } = setup();
    project = setPatternBars(project, pid, 3);
    project = addNote(project, pid, "track-1", 20); // bar 2
    project = addNote(project, pid, "track-2", 16); // bar 2, other track
    return { project, pid };
  }
  const starts = (p: Project) => Object.values(p.patterns[0].notes).map((n) => `${n.trackId}@${n.start}`).sort();

  it("Duplicate Sequence appends the whole sequence, doubling the length", () => {
    const { project, pid } = twoBars();
    const next = duplicateSequence(project, pid);
    expect(next.patterns[0].bars).toBe(6);
    expect(Object.keys(next.patterns[0].notes)).toHaveLength(Object.keys(project.patterns[0].notes).length * 2);
    expect(starts(next)).toContain("track-1@68"); // 20 + 48
    expect(Object.keys(project.patterns[0].notes)).toHaveLength(4); // input unchanged
  });

  it("Duplicate Bar appends the chosen bar to the end, not after the source", () => {
    const { project, pid } = twoBars();
    const next = duplicateBar(project, pid, 1);
    expect(next.patterns[0].bars).toBe(4);
    expect(starts(next).filter((s) => s.endsWith("@52") || s.endsWith("@48"))).toEqual(["track-1@52", "track-2@48"]);
    expect(Object.keys(next.patterns[0].notes)).toHaveLength(6);
  });

  it("Duplicate Bar preserves per-step fields and refuses invalid bars / the 64-bar cap", () => {
    let { project, pid } = setup();
    const n = Object.values(project.patterns[0].notes)[0];
    project = { ...project, patterns: [{ ...project.patterns[0], notes: { [n.id]: { ...n, pitch: 3, lfo: 0.5, velocity: 0.7 } } }] };
    const next = duplicateBar(project, pid, 0);
    const copy = Object.values(next.patterns[0].notes).find((x) => x.id !== n.id)!;
    expect(copy).toMatchObject({ start: 16, pitch: 3, lfo: 0.5, velocity: 0.7, trackId: "track-1" });
    expect(duplicateBar(project, pid, 5)).toEqual(project);
    expect(duplicateSequence(setPatternBars(project, pid, 33), pid).patterns[0].bars).toBe(33);
  });
});

describe("Extend Track", () => {
  // 8-bar pattern (16 steps/bar); track-1 fills bars 0-3, track-2 has one step in bar 1.
  function fourOfEight() {
    let { project, pid } = setup();
    project = setPatternBars(project, pid, 8);
    project = addNote(project, pid, "track-1", 16);
    project = addNote(project, pid, "track-1", 48);
    project = addNote(project, pid, "track-1", 52);
    project = addNote(project, pid, "track-2", 20);
    const pat = project.patterns[0];
    const last = Object.values(pat.notes).find((n) => n.trackId === "track-1" && n.start === 52)!;
    project = { ...project, patterns: [{ ...pat, notes: { ...pat.notes, [last.id]: { ...last, pitch: 5, velocity: 0.4, lfo: 0.3 } } }] };
    return { project, pid };
  }
  const starts = (p: Project, pid: string, t: string) => notes(p, pid, t).map((n) => n.start);

  it("1 bar copies the last bar's steps with all fields and fresh ids", () => {
    const { project, pid } = fourOfEight();
    const next = extendTrack(project, pid, "track-1", 1);
    expect(starts(next, pid, "track-1")).toEqual([0, 4, 16, 48, 52, 64, 68]);
    const copy = notes(next, pid, "track-1").find((n) => n.start === 68)!;
    expect(copy).toMatchObject({ pitch: 5, velocity: 0.4, lfo: 0.3 });
    const ids = new Set(notes(project, pid, "track-1").map((n) => n.id));
    expect(ids.has(copy.id)).toBe(false);
  });

  it("to sequence end repeats only the last bar, leaves other tracks and the length alone", () => {
    const { project, pid } = fourOfEight();
    const next = extendTrack(project, pid, "track-1");
    expect(starts(next, pid, "track-1")).toEqual([0, 4, 16, 48, 52, 64, 68, 80, 84, 96, 100, 112, 116]);
    expect(notes(next, pid, "track-2")).toEqual(notes(project, pid, "track-2"));
    expect(next.patterns[0].bars).toBe(8);
  });

  it("does nothing when the track reaches the end, is empty, or the bars count overshoots", () => {
    const { project, pid } = fourOfEight();
    const full = extendTrack(project, pid, "track-1");
    expect(extendTrack(full, pid, "track-1")).toEqual(full);
    expect(extendTrack(project, pid, "track-9")).toEqual(project);
    expect(starts(extendTrack(project, pid, "track-1", 99), pid, "track-1")).toHaveLength(13);
  });

  it("a note running past the bar end is clamped, and the last occupied bar is the source", () => {
    let { project, pid } = fourOfEight();
    const pat = project.patterns[0];
    const n = Object.values(pat.notes).find((x) => x.trackId === "track-1" && x.start === 52)!;
    project = { ...project, patterns: [{ ...pat, notes: { ...pat.notes, [n.id]: { ...n, duration: 40 } } }] };
    const copy = notes(extendTrack(project, pid, "track-1", 1), pid, "track-1").find((x) => x.start === 68)!;
    expect(copy.duration).toBe(12);
  });

  it("is one reducer action (the app has no undo stack, so prior state is the original)", () => {
    const { project, pid } = fourOfEight();
    const next = reducer(project, { type: "EXTEND_TRACK", patternId: pid, trackId: "track-1" });
    expect(starts(next, pid, "track-1")).toHaveLength(13);
    expect(starts(project, pid, "track-1")).toHaveLength(5);
  });
});
