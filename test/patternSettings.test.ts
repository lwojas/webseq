import { describe, expect, it } from "vitest";
import { createArp } from "../src/model/arp";
import { compilePatternIteration } from "../src/audio/compile";
import { clearPatternSettings, hasPatternSettings, setPatternArp, setPatternEventLfo, trackInPattern } from "../src/model/patternSettings";
import { projectReducer } from "../src/model/reducer";
import { addPattern, createInitialProject, duplicatePattern } from "../src/model/project";
import { addPatternToComposer, copySequence, duplicateSequence, allSequences } from "../src/model/composer";
import type { Note, Pattern, Project } from "../src/model/types";

const note = (id: string, start: number, pitch: number): Note => ({ id, trackId: "track-1", start, duration: 2, velocity: 1, pitch });

/** Two patterns with the same three notes on track-1 (a sample track), no arp on the track itself. */
function setup(): { project: Project; a: string; b: string } {
  let project = createInitialProject();
  project = { ...project, tracks: project.tracks.map((t, i) => (i === 0 ? { ...t, assetId: 1 } : t)) };
  const notes = Object.fromEntries([note("a", 0, 0), note("b", 4, 4), note("c", 8, 7)].map((n) => [n.id, n]));
  project = { ...project, patterns: [{ ...project.patterns[0], notes }] };
  project = addPattern(project);
  project = { ...project, patterns: project.patterns.map((p, i) => (i === 1 ? { ...p, bars: 1, notes } : p)) };
  return { project, a: project.patterns[0].id, b: project.patterns[1].id };
}
const events = (project: Project, patternId: string) => compilePatternIteration(project.patterns.find((p) => p.id === patternId)!, project.tracks, 120, 0).length;

describe("a pattern's own arp and Track LFO", () => {
  it("editing the arp for pattern A leaves the track and pattern B as they were", () => {
    const { project, a, b } = setup();
    const next = projectReducer(project, { type: "SET_TRACK_ARP", trackId: "track-1", patternId: a, patch: { enabled: true, rate: "1/32" } });
    expect(next.tracks[0].arp).toBeUndefined();
    expect(hasPatternSettings(next.patterns[0], "track-1")).toBe(true);
    expect(hasPatternSettings(next.patterns[1], "track-1")).toBe(false);
    expect(events(next, a)).toBe(12);
    expect(events(next, b)).toBe(3);
  });

  it("a pattern without its own settings plays the track's, and the pattern's own wins where it has them", () => {
    const { project, a, b } = setup();
    const track = { ...project.tracks[0], arp: { ...createArp(), enabled: true, rate: "1/32" } };
    const withTrackArp = { ...project, tracks: [track, ...project.tracks.slice(1)] };
    expect(events(withTrackArp, a)).toBe(12);
    expect(events(withTrackArp, b)).toBe(12);
    const off = setPatternArp(withTrackArp, a, "track-1", { enabled: false });
    expect(events(off, a)).toBe(3);
    expect(events(off, b)).toBe(12);
    expect(off.tracks[0].arp).toEqual(track.arp);
  });

  it("the first edit starts from what plays now, so other settings carry over", () => {
    const { project, a } = setup();
    const track = { ...project.tracks[0], arp: { ...createArp(), enabled: true, rate: "1/32", octaves: 2 } };
    const p = setPatternArp({ ...project, tracks: [track, ...project.tracks.slice(1)] }, a, "track-1", { gate: 0.5 });
    expect(p.patterns[0].trackSettings!["track-1"].arp).toMatchObject({ enabled: true, rate: "1/32", octaves: 2, gate: 0.5 });
  });

  it("the Track LFO is per pattern too, clamped like the track's", () => {
    const { project, a, b } = setup();
    const p = setPatternEventLfo(project, a, "track-1", { enabled: true, depth: 5 });
    expect(p.patterns[0].trackSettings!["track-1"].eventLfo).toMatchObject({ enabled: true, depth: 1 });
    expect(p.tracks[0].eventLfo).toBeUndefined();
    expect(trackInPattern(p.tracks[0], p.patterns[1])).toBe(p.tracks[0]);
    expect(p.patterns.find((x) => x.id === b)!.trackSettings).toBeUndefined();
  });

  it("Use track's drops the pattern's own settings", () => {
    const { project, a } = setup();
    const edited = setPatternArp(project, a, "track-1", { enabled: true });
    const cleared = projectReducer(edited, { type: "RESET_PATTERN_TRACK_SETTINGS", patternId: a, trackId: "track-1" });
    expect(cleared.patterns[0].trackSettings).toBeUndefined();
    expect(clearPatternSettings(cleared, a, "track-1").patterns).toEqual(cleared.patterns);
  });

  it("a duplicate of a pattern, in the list or in the Composer, keeps them", () => {
    const { project, a } = setup();
    const edited = setPatternArp(project, a, "track-1", { enabled: true, rate: "1/32" });
    const dup = duplicatePattern(edited, a);
    expect(dup.patterns[dup.patterns.length - 1].trackSettings).toEqual(edited.patterns[0].trackSettings);
    const placed = addPatternToComposer(edited, a);
    const seqId = allSequences(placed)[0].seq.id;
    expect(copySequence(placed, seqId)!.trackSettings).toEqual(edited.patterns[0].trackSettings);
    const copied = duplicateSequence(placed, seqId);
    expect((copied.patterns[copied.patterns.length - 1] as Pattern).trackSettings).toEqual(edited.patterns[0].trackSettings);
  });
});

describe("a pattern's notes switched off for a track", () => {
  it("silences the track in that pattern only, keeps its notes and the track's own mute", () => {
    const { project, a, b } = setup();
    const next = projectReducer(project, { type: "SET_PATTERN_TRACK_OFF", patternId: a, trackId: "track-1", off: true });
    expect(events(next, a)).toBe(0);
    expect(events(next, b)).toBe(3);
    expect(Object.keys(next.patterns[0].notes)).toHaveLength(3);
    expect(next.tracks[0].muted).toBeFalsy();
  });

  it("switching back on drops the entry, so the pattern is as it was", () => {
    const { project, a } = setup();
    const off = projectReducer(project, { type: "SET_PATTERN_TRACK_OFF", patternId: a, trackId: "track-1", off: true });
    const on = projectReducer(off, { type: "SET_PATTERN_TRACK_OFF", patternId: a, trackId: "track-1", off: false });
    expect(on.patterns[0].offTracks).toBeUndefined();
    expect(events(on, a)).toBe(3);
  });

  it("is carried by Duplicate pattern, Duplicate sequence and copy / paste", () => {
    const { project, a } = setup();
    const off = projectReducer(project, { type: "SET_PATTERN_TRACK_OFF", patternId: a, trackId: "track-1", off: true });
    const dup = duplicatePattern(off, a);
    expect(dup.patterns[dup.patterns.length - 1].offTracks).toEqual({ "track-1": true });
    const placed = addPatternToComposer(off, a);
    const seqId = allSequences(placed)[0].seq.id;
    expect(copySequence(placed, seqId)!.offTracks).toEqual({ "track-1": true });
  });
});
