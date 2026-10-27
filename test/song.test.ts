import { describe, expect, it, vi } from "vitest";
import type { AudioRuntime, ScheduledEvent, VoiceHandle } from "webdsp";
import { Transport } from "../src/audio/transport";
import { Playback } from "../src/audio/playback";
import { compileNativeSequence } from "../src/audio/nativeSequence";
import type { AutomationScope } from "../src/audio/automation";
import { addBlankSequence, addLane, addPatternToComposer, allSequences, composerLanes, moveSequence, resizeSequence, setLaneModifiers, type PlaybackSource } from "../src/model/composer";
import { addAsset, addNote, addPattern, assignAsset, createInitialProject, setBpm } from "../src/model/project";
import { projectReducer } from "../src/model/reducer";
import type { Project } from "../src/model/types";

// Same approach as transport.test.ts: the engine is faked, the Transport's own scheduling is real.
function fakeRuntime() {
  let time = 0;
  let handle = 1;
  const scheduled: ScheduledEvent[] = [];
  const runtime = {
    getCurrentTime: () => time,
    trigger: vi.fn(() => handle++),
    onVoiceEnded: vi.fn(() => () => {}),
    schedule: vi.fn((events: ScheduledEvent[]) => {
      scheduled.push(...events);
      return events.map(() => handle++);
    }),
    cancelScheduled: vi.fn(),
    setTempo: vi.fn(),
    release: vi.fn((_h: VoiceHandle) => {}),
    getCapabilities: vi.fn(() => ({ maxCaptureSeconds: 30 })),
  };
  return { runtime: runtime as unknown as AudioRuntime, scheduled, advance: (dt: number) => (time += dt) };
}
const noBus = () => undefined;
const asset = (id: number) => ({ id, name: `s${id}.wav`, type: "audio" as const, duration: 1, sampleRate: 48000, channels: 2, origin: "import" as const });

/** 120 bpm, 16 beats/bar: a bar is 2 s. Sample 1 on track-1 and sample 2 on track-2. Launcher pattern A has a note on track-1
 * (the "drums"), pattern B one on track-2 (the "bass"). Lane "Drums" holds copies of A at bars 0 and 2; lane "Bass" a copy of
 * B at bar `bassAt`. Lanes say nothing about tracks: each sequence plays the tracks its own pattern has notes for. */
function song(bassAt = 1): Project {
  let p = setBpm(createInitialProject("t", 4), 120);
  p = assignAsset(assignAsset(addAsset(addAsset(p, asset(1)), asset(2)), "track-1", 1), "track-2", 2);
  p = addNote(p, p.patterns[0].id, "track-1", 0);
  p = addPattern(p, "Pattern B");
  p = addNote(p, p.patterns[1].id, "track-2", 0);
  const [a, bPattern] = [p.patterns[0].id, p.patterns[1].id];
  p = addLane(addPatternToComposer(p, a), "Bass");
  p = addPatternToComposer(p, a, composerLanes(p)[0].id); // drums 2nd
  p = addPatternToComposer(p, bPattern, composerLanes(p)[1].id); // bass 1st
  p = moveSequence(p, composerLanes(p)[0].sequences[1].id, 2);
  return moveSequence(p, composerLanes(p)[1].sequences[0].id, bassAt);
}

function setup(project: () => Project, source: () => PlaybackSource) {
  vi.useFakeTimers();
  const fake = fakeRuntime();
  const transport = new Transport(fake.runtime, project, noBus, new Playback(fake.runtime, noBus, () => false), undefined, source);
  return { ...fake, transport, done: () => { transport.stop(); vi.useRealTimers(); } };
}
const byTime = (s: ScheduledEvent[]) => [...s].sort((a, b) => a.time - b.time).map((e) => [Math.round(e.time * 100) / 100, e.sampleId]);
/** Runs the transport for `seconds`, ticking as the clock moves. */
function run(t: ReturnType<typeof setup>, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) {
    t.advance(0.1);
    vi.advanceTimersByTime(25);
  }
}

describe("Song mode playback", () => {
  it("plays each lane's sequences at their positions, each through the tracks its pattern has notes for", () => {
    const project = song(1);
    const t = setup(() => project, () => "song");
    t.transport.play();
    run(t, 5.5);
    // drums (sample 1) at bars 0 and 2, bass (sample 2) at bar 1
    expect(byTime(t.scheduled)).toEqual([[0.05, 1], [2.05, 2], [4.05, 1]]);
    t.done();
  });

  it("lanes play at the same time, a gap on one lane is silence on that lane only", () => {
    const project = song(0); // bass at bar 0, beside drums
    const t = setup(() => project, () => "song");
    t.transport.play();
    expect(byTime(t.scheduled).map(([, id]) => id).sort()).toEqual([1, 2]); // both at 0.05
    expect(new Set(t.scheduled.map((e) => e.time)).size).toBe(1);
    run(t, 3); // bars 1 (drums gap, bass gap): nothing new until bar 2
    expect(t.scheduled).toHaveLength(2);
    run(t, 1.5); // bar 2: drums again, bass is in its gap
    expect(byTime(t.scheduled).slice(2)).toEqual([[4.05, 1]]);
    t.done();
  });

  it("loops at the end of the longest lane", () => {
    const project = song(1); // 3 bars = 6 s
    const t = setup(() => project, () => "song");
    t.transport.play();
    run(t, 6.2);
    expect(byTime(t.scheduled)).toEqual([[0.05, 1], [2.05, 2], [4.05, 1], [6.05, 1]]);
    t.done();
  });

  it("reports what sounds on each lane, and the song position", () => {
    const project = song(0);
    const [drums, bass] = composerLanes(project);
    const t = setup(() => project, () => "song");
    expect(t.transport.getSongPosition()).toBeNull(); // stopped
    t.transport.play();
    t.advance(1.05); // 1 s in = beat 8
    const pos = t.transport.getSongPosition()!;
    expect(pos.songBeat).toBeCloseTo(8, 3);
    expect(pos.active.map((a) => a.laneId)).toEqual([drums.id, bass.id]);
    expect(pos.active[0].beat).toBeCloseTo(8, 3);
    expect(t.transport.getPlayheadBeatFor(drums.sequences[0].patternId)).toBeCloseTo(8, 3);
    expect(t.transport.getPlayheadBeatFor(drums.sequences[1].patternId)).toBeNull();
    t.advance(1.5); // 2.55 s: bars 1: nothing on either lane
    expect(t.transport.getSongPosition()!.active).toEqual([]);
    t.done();
  });

  it("plays from a song position, and pauses and resumes at it", () => {
    const project = song(1);
    const t = setup(() => project, () => "song");
    t.transport.playFromBeat(2 * 16); // bar 2: the second drums sequence
    expect(t.transport.getSongPosition()!.active[0].sequenceId).toBe(composerLanes(project)[0].sequences[1].id);
    t.advance(0.55);
    t.transport.pause();
    t.advance(5);
    t.transport.play();
    expect(t.transport.getSongPosition()!.songBeat).toBeCloseTo(2 * 16 + 4, 0); // 0.5 s into the bar
    t.done();
  });

  it("plays what a sequence's pattern holds right now (no copy)", () => {
    let project = song(1);
    const t = setup(() => project, () => "song");
    t.transport.play();
    project = projectReducer(project, { type: "ADD_NOTE", patternId: composerLanes(project)[0].sequences[1].patternId, trackId: "track-1", start: 4 });
    run(t, 4.5);
    expect(byTime(t.scheduled).filter(([, id]) => id === 1)).toHaveLength(3); // bar 0, then two notes at bar 2
    t.done();
  });

  it("a lane's modifiers change the notes it plays (velocity here) and nothing else", () => {
    let project = song(1);
    project = setLaneModifiers(project, composerLanes(project)[1].id, { velocity: 0.5, transpose: 5 });
    const t = setup(() => project, () => "song");
    t.transport.play();
    run(t, 3);
    const bass = t.scheduled.find((e) => e.sampleId === 2)!;
    const drums = t.scheduled.find((e) => e.sampleId === 1)!;
    expect(bass.gain).toBeCloseTo(drums.gain! * 0.5);
    expect(bass.pitch).toBe(5);
    expect(drums.pitch ?? 0).toBe(0);
    const stored = project.patterns.find((p) => p.id === composerLanes(project)[1].sequences[0].patternId)!;
    expect(Object.values(stored.notes).every((n) => n.pitch === undefined)).toBe(true); // the stored pattern is not rewritten
    t.done();
  });

  it("a longer sequence plays its whole pattern", () => {
    let project = song(1);
    project = resizeSequence(project, composerLanes(project)[1].sequences[0].id, 1);
    project = projectReducer(project, { type: "ADD_NOTE", patternId: composerLanes(project)[1].sequences[0].patternId, trackId: "track-2", start: 12 });
    const t = setup(() => project, () => "song");
    t.transport.play();
    run(t, 3);
    expect(byTime(t.scheduled).filter(([, id]) => id === 2).map(([time]) => time)).toEqual([2.05, 3.55]);
    t.done();
  });

  it("leaves Pattern mode exactly as it was: the queue plays, the Composer is ignored", () => {
    const project = song(1);
    const t = setup(() => project, () => "pattern");
    t.transport.play();
    expect(t.scheduled).toHaveLength(1); // launcher pattern A's note
    run(t, 2);
    expect(t.scheduled).toHaveLength(2); // looping every 2 s, no gaps
    expect(t.transport.getCurrentChainEntryId()).not.toBeNull();
    expect(t.transport.getSongPosition()).toBeNull();
    t.done();
  });

  it("with nothing composed, Song mode schedules nothing and does not spin", () => {
    const project = createInitialProject();
    const t = setup(() => project, () => "song");
    t.transport.play();
    run(t, 5);
    expect(t.scheduled).toHaveLength(0);
    expect(t.transport.getSongPosition()).toMatchObject({ songBeat: 0, active: [] });
    t.done();
  });
});

describe("native sequence in Song mode", () => {
  const spy = () => {
    const calls: { start: number; beats: number; scope?: AutomationScope }[] = [];
    return { calls, ctx: { getBusId: noBus, instrumentIdFor: () => 1, hasSample: () => true, automation: (start: number, beats: number, scope?: AutomationScope) => (calls.push({ start, beats, scope }), []) } };
  };

  it("lays lanes out at their song positions; each lane plays its own tracks", () => {
    const { ctx } = spy();
    const seq = compileNativeSequence(song(1), { ...ctx, source: "song" })!;
    expect(seq.lengthBeats).toBe((3 * 16) / 4);
    expect(seq.events.map((e) => [e.beat, (e as { sample?: number }).sample]).sort((a, b) => (a[0] as number) - (b[0] as number))).toEqual([[0, 1], [4, 2], [8, 1]]);
  });

  it("replays track automation per sequence over the tracks it has notes for, and the master's over the top lane", () => {
    const { ctx, calls } = spy();
    compileNativeSequence(song(1), { ...ctx, source: "song" });
    expect(calls.map((c) => c.start)).toEqual([0, 16, 32]);
    expect(calls.map((c) => [...(c.scope!.tracks ?? [])])).toEqual([["track-1"], ["track-2"], ["track-1"]]);
    expect(calls.map((c) => c.scope!.master)).toEqual([true, false, true]);
  });

  it("is unchanged for the queue", () => {
    const { ctx } = spy();
    expect(compileNativeSequence(song(1), ctx)!.lengthBeats).toBe(16 / 4);
  });
});

describe("song helpers used by the tests", () => {
  it("addBlankSequence creates the first lane when there is none", () => {
    expect(allSequences(addBlankSequence(createInitialProject()))).toHaveLength(1);
  });
});
