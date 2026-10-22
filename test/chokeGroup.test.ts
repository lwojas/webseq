import { describe, expect, it, vi } from "vitest";
import type { AudioRuntime, TriggerParams, VoiceHandle } from "webdsp";
import { compileInstrumentNotes, compilePatternIterationTracked } from "../src/audio/compile";
import { Playback } from "../src/audio/playback";
import { addNote } from "../src/model/notes";
import { createInitialProject, setTrackChokeGroup, setTrackVoiceMode } from "../src/model/project";
import { projectReducer as reducer } from "../src/model/reducer";
import { copyTrackConfig, hasTrackConfig, pasteTrackConfig } from "../src/model/trackConfig";
import { copyInstrument, pasteInstrument } from "../src/model/edit";
import { parseRecoveryRecord } from "../src/persistence/recovery";
import type { Pattern, Project, Track } from "../src/model/types";
import { effectiveChokeGroup, trackById } from "../src/model/types";

const BEATS_PER_BAR = 16;

/** track-1 = kick, track-2 = open hat, track-3 = closed hat, track-4 = snare; each on its own bus. */
function drumKit(groups: Record<string, number | null>): Project {
  let project = createInitialProject();
  project = {
    ...project,
    assets: [1, 2, 3, 4].map((id) => ({ id, name: `s${id}`, type: "audio" as const, duration: 1, sampleRate: 48000, channels: 2, origin: "import" as const })),
    tracks: project.tracks.map((t, i) => (i < 4 ? { ...t, assetId: i + 1 } : t)),
  };
  for (const [trackId, group] of Object.entries(groups)) project = setTrackChokeGroup(project, trackId, group);
  return project;
}

const busFor = (trackId: string) => Number(trackId.replace("track-", "")) + 10;

function compileAll(project: Project, notes: [string, number][]) {
  let pattern: Pattern = project.patterns[0];
  for (const [trackId, start] of notes) pattern = addNote(pattern, BEATS_PER_BAR, trackId, start, 1);
  return compilePatternIterationTracked(pattern, project.tracks, 120, 0, busFor, 0.5, undefined, BEATS_PER_BAR);
}

describe("track chokeGroup model", () => {
  it("new projects default to no choke group", () => {
    for (const t of createInitialProject().tracks) {
      expect(t.chokeGroup).toBeNull();
      expect(effectiveChokeGroup(t)).toBeNull();
    }
  });

  it("a track from an older project without the field means none", () => {
    const legacy = { id: "track-1", assetId: 1, name: "x", fx: [], automation: [], volume: 1, muted: false, soloed: false } as Track;
    expect(legacy.chokeGroup).toBeUndefined();
    expect(effectiveChokeGroup(legacy)).toBeNull();
  });

  it("only a positive integer is a group; anything else is none", () => {
    for (const bad of [0, -1, 1.5, NaN, undefined, null]) expect(effectiveChokeGroup({ chokeGroup: bad as number })).toBeNull();
    expect(effectiveChokeGroup({ chokeGroup: 3 })).toBe(3);
    const project = setTrackChokeGroup(createInitialProject(), "track-1", 0);
    expect(trackById(project, "track-1")!.chokeGroup).toBeNull();
  });

  it("is set through the reducer and can be cleared", () => {
    let project = reducer(createInitialProject(), { type: "SET_TRACK_CHOKE_GROUP", trackId: "track-2", chokeGroup: 1 });
    expect(trackById(project, "track-2")!.chokeGroup).toBe(1);
    expect(trackById(project, "track-1")!.chokeGroup).toBeNull();
    project = reducer(project, { type: "SET_TRACK_CHOKE_GROUP", trackId: "track-2", chokeGroup: null });
    expect(trackById(project, "track-2")!.chokeGroup).toBeNull();
  });

  it("travels with copy/paste of track config and of the instrument clip", () => {
    let project = setTrackChokeGroup(drumKit({}), "track-2", 2);
    const source = trackById(project, "track-2")!;
    expect(hasTrackConfig({ ...trackById(project, "track-1")!, assetId: null })).toBe(false);
    expect(hasTrackConfig({ ...source, assetId: null })).toBe(true);
    project = pasteTrackConfig(project, "track-3", copyTrackConfig(source));
    expect(trackById(project, "track-3")!.chokeGroup).toBe(2);
    project = pasteInstrument(project, "track-4", copyInstrument(source));
    expect(trackById(project, "track-4")!.chokeGroup).toBe(2);
  });
});

describe("persistence", () => {
  it("survives a JSON round trip (save/load) and structured clone (IndexedDB, recovery)", () => {
    const project = drumKit({ "track-2": 1, "track-3": 1 });
    for (const copy of [JSON.parse(JSON.stringify(project)) as Project, structuredClone(project)]) {
      expect(trackById(copy, "track-2")!.chokeGroup).toBe(1);
      expect(trackById(copy, "track-3")!.chokeGroup).toBe(1);
      expect(trackById(copy, "track-1")!.chokeGroup).toBeNull();
    }
  });

  it("a recovery record keeps the group, and one from an older build without it still parses", () => {
    const project = drumKit({ "track-2": 4 });
    const ui = { selectedPatternId: project.patterns[0].id, selectedTarget: "master", activeBank: 0, gridResolution: 1 };
    const parsed = parseRecoveryRecord({ projectId: project.id, savedAt: 1, project, ui });
    expect(trackById(parsed!.project, "track-2")!.chokeGroup).toBe(4);

    const old = JSON.parse(JSON.stringify(project)) as Project;
    for (const t of old.tracks) delete t.chokeGroup;
    const parsedOld = parseRecoveryRecord({ projectId: old.id, savedAt: 1, project: old, ui });
    expect(parsedOld).not.toBeNull();
    expect(effectiveChokeGroup(trackById(parsedOld!.project, "track-2")!)).toBeNull();
  });
});

describe("sequenced events carry the choke group to the engine", () => {
  const hats = [["track-2", 0], ["track-3", 4]] as [string, number][];

  it("hats in group 1 are tagged with it, each on its own bus; the group's relationship stays in the engine", () => {
    const project = drumKit({ "track-2": 1, "track-3": 1 });
    const compiled = compileAll(project, [["track-1", 0], ...hats, ["track-4", 2]]);
    const byTrack = (id: string) => compiled.filter((c) => c.trackId === id).map((c) => c.event);
    expect(byTrack("track-2")[0].chokeGroup).toBe(1);
    expect(byTrack("track-3")[0].chokeGroup).toBe(1);
    expect(byTrack("track-2")[0].bus).not.toBe(byTrack("track-3")[0].bus);
    // No choke on the tracks outside the group, and no property at all (not even undefined).
    expect("chokeGroup" in byTrack("track-1")[0]).toBe(false);
    expect("chokeGroup" in byTrack("track-4")[0]).toBe(false);
  });

  it("different groups stay different groups", () => {
    const compiled = compileAll(drumKit({ "track-2": 1, "track-3": 2 }), hats);
    expect(compiled.map((c) => c.event.chokeGroup)).toEqual([1, 2]);
  });

  it("without any group the compiled events are exactly what they were before", () => {
    const compiled = compileAll(drumKit({}), [["track-1", 0], ...hats]);
    for (const c of compiled) expect("chokeGroup" in c.event).toBe(false);
  });

  it("does not touch mono truncation or the voice's duration", () => {
    const notes: [string, number][] = [["track-2", 0], ["track-2", 2]];
    const plain = compileAll(setTrackVoiceMode(drumKit({}), "track-2", "mono"), notes).map((c) => c.event.duration);
    const grouped = compileAll(setTrackVoiceMode(drumKit({ "track-2": 1 }), "track-2", "mono"), notes).map((c) => c.event.duration);
    expect(grouped).toEqual(plain);
  });
});

describe("manual triggers", () => {
  function setup() {
    const triggered: TriggerParams[] = [];
    let next = 1;
    const runtime = {
      trigger: vi.fn((p: TriggerParams) => (triggered.push(p), next++ as VoiceHandle)),
      release: vi.fn(),
      onVoiceEnded: vi.fn(() => () => {}),
    } as unknown as AudioRuntime;
    return { playback: new Playback(runtime, (t) => (t.startsWith("track-") ? Number(t.slice(6)) + 10 : undefined), () => false), triggered, runtime };
  }

  it("a grouped track's pad hit carries the group; an ungrouped one does not", () => {
    const { playback, triggered, runtime } = setup();
    const project = drumKit({ "track-3": 1 });
    playback.pressTrack(trackById(project, "track-3")!);
    playback.pressTrack(trackById(project, "track-1")!);
    expect(triggered[0]).toEqual({ sampleId: 3, bus: 13, chokeGroup: 1 });
    expect(triggered[1]).toEqual({ sampleId: 1, bus: 11 });
    // The cut is the engine's: the sequencer-side table does no releasing for a group.
    expect(runtime.release).not.toHaveBeenCalled();
  });
});

describe("synth tracks", () => {
  function synthKit(groups: Record<string, number | null>): Project {
    let project = createInitialProject();
    project = {
      ...project,
      tracks: project.tracks.map((t, i) => (i < 3 ? { ...t, assetId: null, instrument: { kind: i === 2 ? "kick" : "hihat", params: {} } } : t)) as Track[],
    };
    for (const [trackId, group] of Object.entries(groups)) project = setTrackChokeGroup(project, trackId, group);
    return project;
  }
  const compile = (project: Project) => {
    let pattern: Pattern = project.patterns[0];
    for (const trackId of ["track-1", "track-2", "track-3"]) pattern = addNote(pattern, BEATS_PER_BAR, trackId, 0, 1);
    return compileInstrumentNotes(pattern, project.tracks, 120, 0, 0.5, undefined, BEATS_PER_BAR);
  };

  it("grouped synth notes carry the group; ungrouped ones do not", () => {
    const notes = compile(synthKit({ "track-1": 1, "track-2": 1 }));
    const by = (id: string) => notes.find((n) => n.trackId === id)!.params;
    expect(by("track-1").chokeGroup).toBe(1);
    expect(by("track-2").chokeGroup).toBe(1);
    expect("chokeGroup" in by("track-3")).toBe(false);
  });
});
