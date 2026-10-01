import { describe, expect, it, vi } from "vitest";
import type { AudioRuntime, CaptureHandle, RuntimeCapabilities, SampleMetadata, ScheduledEvent, VoiceHandle } from "webdsp";
import { Transport } from "../src/audio/transport";
import { secondsPerBeat } from "../src/audio/compile";
import { addAsset, addNote } from "../src/model/project";
import { addPattern, appendToChain, assignAsset, createInitialProject, setBpm, setSwing } from "../src/model/project";
import type { Asset, Project } from "../src/model/types";

// AudioRuntime needs a real browser (AudioContext/AudioWorklet) — not available under
// Node/vitest — so, like webdsp's own LookaheadPlayer test, Transport's scheduling logic is
// exercised against a faked runtime instead.
function fakeRuntime(maxCaptureSeconds = 30) {
  let time = 0;
  let nextHandle = 1;
  let nextCaptureId = 1;
  const scheduled: ScheduledEvent[] = [];
  const released: VoiceHandle[] = [];
  const armCaptureCalls: { startTime: number; stopTime: number }[] = [];
  // Each armCapture() call gets its own controllable pending promise, so a test can settle
  // (or leave hanging) exactly the capture it cares about without racing unrelated ones.
  const pendingArmCaptures: { resolve: (r: { metadata: SampleMetadata; channelData: ArrayBuffer[] }) => void; reject: (e: Error) => void }[] = [];
  const runtime = {
    getCurrentTime: () => time,
    schedule: vi.fn((events: ScheduledEvent[]) => {
      scheduled.push(...events);
      return events.map(() => nextHandle++);
    }),
    cancelScheduled: vi.fn(),
    release: vi.fn((h: VoiceHandle) => released.push(h)),
    getCapabilities: vi.fn((): RuntimeCapabilities => ({
      sampleRate: 48000,
      outputChannels: 2,
      maxVoices: 64,
      renderQuantumFrames: 128,
      maxCaptureSeconds,
    })),
    armCapture: vi.fn((opts: { startTime: number; stopTime: number }): { handle: CaptureHandle; result: Promise<{ metadata: SampleMetadata; channelData: ArrayBuffer[] }> } => {
      armCaptureCalls.push({ startTime: opts.startTime, stopTime: opts.stopTime });
      const id = nextCaptureId++;
      const result = new Promise<{ metadata: SampleMetadata; channelData: ArrayBuffer[] }>((resolve, reject) => {
        pendingArmCaptures.push({ resolve, reject });
      });
      return { handle: { id }, result };
    }),
  };
  return {
    runtime: runtime as unknown as AudioRuntime,
    scheduled,
    released,
    armCaptureCalls,
    resolveLastArmCapture: (meta: SampleMetadata, channelData: ArrayBuffer[] = []) =>
      pendingArmCaptures[pendingArmCaptures.length - 1]?.resolve({ metadata: meta, channelData }),
    rejectLastArmCapture: (err: Error) => pendingArmCaptures[pendingArmCaptures.length - 1]?.reject(err),
    cancelScheduled: runtime.cancelScheduled,
    advance: (dt: number) => (time += dt),
  };
}

const noBus = () => undefined;

function makeAsset(id: number, name: string): Asset {
  return { id, name, type: "audio", duration: 1, sampleRate: 48000, channels: 2, origin: "import" };
}

const fakeSampleMetadata: SampleMetadata = {
  id: 999,
  name: "capture-1",
  channels: 2,
  sampleRate: 48000,
  length: 96000,
  duration: 2,
  byteLength: 96000 * 2 * 4,
};

/** One pattern (1 bar, 16 beats/bar -> 2s per loop @120bpm) with a single note on track-1,
 * chained to itself (so it behaves like the original single-pattern prototype). */
function singlePatternProject(): Project {
  let project = setBpm(createInitialProject(), 120);
  project = addAsset(project, makeAsset(1, "kick.wav"));
  project = assignAsset(project, "track-1", 1);
  project = addNote(project, project.patterns[0].id, "track-1", 0);
  return project;
}

describe("Transport", () => {
  it("schedules the first chain step on play()", () => {
    vi.useFakeTimers();
    const { runtime, scheduled } = fakeRuntime();
    const project = singlePatternProject();
    const transport = new Transport(runtime, () => project, noBus);

    transport.play();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].sampleId).toBe(1);

    transport.stop();
    vi.useRealTimers();
  });

  it("loops a single-pattern chain: tops up the next iteration once the lookahead window reaches it", () => {
    vi.useFakeTimers();
    const { runtime, scheduled, advance } = fakeRuntime();
    const project = singlePatternProject(); // one loop = 16 * 0.125s = 2s
    const transport = new Transport(runtime, () => project, noBus);

    transport.play();
    expect(scheduled).toHaveLength(1);

    advance(2.0); // now at the loop boundary
    vi.advanceTimersByTime(25);
    expect(scheduled.length).toBeGreaterThanOrEqual(2);

    transport.stop();
    vi.useRealTimers();
  });

  it("plays a multi-pattern chain continuously across a pattern boundary with no gap", () => {
    vi.useFakeTimers();
    const { runtime, scheduled, advance } = fakeRuntime();
    let project = setBpm(createInitialProject(), 120);
    project = addAsset(project, makeAsset(1, "kick.wav"));
    project = assignAsset(project, "track-1", 1);
    project = addNote(project, project.patterns[0].id, "track-1", 0); // Pattern A: 1 bar = 2s
    project = addPattern(project, "Pattern B", 2); // Pattern B: 2 bars = 4s
    const patternB = project.patterns[1].id;
    project = addNote(project, patternB, "track-1", 0);
    project = appendToChain(project, patternB); // chain: [A, B]

    const transport = new Transport(runtime, () => project, noBus);
    transport.play();
    expect(scheduled).toHaveLength(1); // only step A's note is within the initial lookahead

    advance(2.0); // A's 2s have elapsed -> step B should now be scheduled, gaplessly
    vi.advanceTimersByTime(25);
    expect(scheduled).toHaveLength(2);
    // Step B's note lands exactly where step A's ends — no timing gap between patterns.
    expect(scheduled[1].time).toBeCloseTo(scheduled[0].time + 2.0, 5);

    transport.stop();
    vi.useRealTimers();
  });

  it("wraps back to the start of the chain after the last step", () => {
    vi.useFakeTimers();
    const { runtime, scheduled, advance } = fakeRuntime();
    let project = setBpm(createInitialProject(), 120);
    project = addAsset(project, makeAsset(1, "kick.wav"));
    project = assignAsset(project, "track-1", 1);
    const patternA = project.patterns[0].id;
    project = addNote(project, patternA, "track-1", 0);
    // chain already has one A entry by default; leave it as a 1-step chain that loops on A.
    const transport = new Transport(runtime, () => project, noBus);

    transport.play();
    advance(2.0);
    vi.advanceTimersByTime(25);
    advance(2.0);
    vi.advanceTimersByTime(25);
    expect(scheduled.length).toBeGreaterThanOrEqual(3); // A, A, A... looped, never stalled

    transport.stop();
    vi.useRealTimers();
  });

  it("editing the chain during playback only affects steps not yet scheduled", () => {
    vi.useFakeTimers();
    const { runtime, scheduled, advance } = fakeRuntime();
    let project = setBpm(createInitialProject(), 120);
    project = addAsset(project, makeAsset(1, "kick.wav"));
    project = assignAsset(project, "track-1", 1);
    const patternA = project.patterns[0].id;
    project = addNote(project, patternA, "track-1", 0);
    project = addPattern(project, "Pattern B", 1);
    const patternB = project.patterns[1].id;
    project = addNote(project, patternB, "track-1", 4);

    let liveProject = project; // chain: [A] only, so far
    const transport = new Transport(runtime, () => liveProject, noBus);

    transport.play();
    expect(scheduled).toHaveLength(1); // A's step 0 already committed

    // Edit the chain now, before step 1 (the next A-loop) has been scheduled.
    liveProject = appendToChain(liveProject, patternB); // chain becomes [A, B]

    advance(2.0); // A's first playthrough ends -> the *next* step should now resolve to B
    vi.advanceTimersByTime(25);
    const stepTwoSampleTimes = scheduled.slice(1);
    expect(stepTwoSampleTimes.length).toBeGreaterThan(0);
    // Step 1 is now Pattern B's note (start beat 4), not another A (start beat 0).
    expect(stepTwoSampleTimes[0].time).toBeCloseTo(scheduled[0].time + 2.0 + 4 * 0.125, 5);

    transport.stop();
    vi.useRealTimers();
  });

  it("editing a pattern's notes during playback leaves already-scheduled audio untouched", () => {
    vi.useFakeTimers();
    const { runtime, scheduled, cancelScheduled, advance } = fakeRuntime();
    let project = singlePatternProject();
    let liveProject = project;
    const transport = new Transport(runtime, () => liveProject, noBus);

    transport.play();
    expect(scheduled).toHaveLength(1);

    // Add a second note to the same (already-scheduled) playthrough's pattern.
    liveProject = addNote(liveProject, liveProject.patterns[0].id, "track-1", 8);
    expect(cancelScheduled).not.toHaveBeenCalled(); // nothing already scheduled was touched

    advance(2.0); // next loop iteration should reflect the edit (2 notes now)
    vi.advanceTimersByTime(25);
    expect(scheduled.length).toBe(3); // 1 (old loop) + 2 (new loop, both notes)

    transport.stop();
    vi.useRealTimers();
  });

  it("derives the playhead from the engine clock and wraps at a pattern boundary", () => {
    vi.useFakeTimers();
    const { runtime, advance } = fakeRuntime();
    const project = singlePatternProject();
    const transport = new Transport(runtime, () => project, noBus);

    const LEAD_IN = 0.05;
    transport.play();
    advance(LEAD_IN + 0.125); // one beat past the lead-in
    expect(transport.getPlayheadBeat()).toBeCloseTo(1, 5);
    expect(transport.getPlayheadInfo().patternId).toBe(project.patterns[0].id);

    advance(2.0); // one full loop further -> wraps back to the same phase
    expect(transport.getPlayheadBeat()).toBeCloseTo(1, 5);

    transport.stop();
    vi.useRealTimers();
  });

  it("stop() cancels not-yet-fired events and releases active voices", () => {
    vi.useFakeTimers();
    const { runtime, cancelScheduled, released } = fakeRuntime();
    const project = singlePatternProject();
    const transport = new Transport(runtime, () => project, noBus);

    transport.play();
    transport.stop();

    expect(cancelScheduled).toHaveBeenCalled();
    expect(released).toHaveLength(1);
    expect(transport.getStatus()).toBe("stopped");
    expect(transport.getPlayheadBeat()).toBe(0);

    vi.useRealTimers();
  });

  it("pause() remembers position, and play() resumes from it", () => {
    vi.useFakeTimers();
    const { runtime, advance } = fakeRuntime();
    const project = singlePatternProject();
    const transport = new Transport(runtime, () => project, noBus);

    transport.play();
    advance(0.05 + 0.5); // past the 0.05s lead-in, then 4 beats in
    transport.pause();
    expect(transport.getStatus()).toBe("paused");
    expect(transport.getPlayheadBeat()).toBeCloseTo(4, 4);

    transport.play();
    expect(transport.getPlayheadBeat()).toBeCloseTo(4, 4);

    transport.stop();
    vi.useRealTimers();
  });
});

describe("Transport swing", () => {
  const spb = secondsPerBeat(120); // one 16th at 120 BPM

  it("50% swing reproduces the existing straight timing (no-op)", () => {
    vi.useFakeTimers();
    const { runtime, scheduled } = fakeRuntime();
    let project = setBpm(createInitialProject(), 120);
    project = setSwing(project, 0.5);
    project = addAsset(project, makeAsset(1, "kick.wav"));
    project = assignAsset(project, "track-1", 1);
    project = addNote(project, project.patterns[0].id, "track-1", 1); // odd step -> would be swung if swing != 50%

    const transport = new Transport(runtime, () => project, noBus);
    transport.play();
    expect(scheduled[0].time).toBeCloseTo(0.05 + 1 * spb, 10);

    transport.stop();
    vi.useRealTimers();
  });

  it("delays only the second (odd-indexed) 16th of a pair at 66.67% swing", () => {
    vi.useFakeTimers();
    const { runtime, scheduled } = fakeRuntime();
    let project = setBpm(createInitialProject(), 120);
    project = setSwing(project, 2 / 3);
    project = addAsset(project, makeAsset(1, "kick.wav"));
    project = assignAsset(project, "track-1", 1);
    project = addNote(project, project.patterns[0].id, "track-1", 1);

    const transport = new Transport(runtime, () => project, noBus);
    transport.play();
    expect(scheduled[0].time).toBeCloseTo(0.05 + 1 * spb + spb * (2 / 3 - 0.5), 10);

    transport.stop();
    vi.useRealTimers();
  });

  it("leaves the first (even-indexed) 16th of a pair on the normal grid at strong (75%) swing", () => {
    vi.useFakeTimers();
    const { runtime, scheduled } = fakeRuntime();
    let project = setBpm(createInitialProject(), 120);
    project = setSwing(project, 0.75);
    project = addAsset(project, makeAsset(1, "kick.wav"));
    project = assignAsset(project, "track-1", 1);
    project = addNote(project, project.patterns[0].id, "track-1", 4); // even step -> first of its pair

    const transport = new Transport(runtime, () => project, noBus);
    transport.play();
    expect(scheduled[0].time).toBeCloseTo(0.05 + 4 * spb, 10);

    transport.stop();
    vi.useRealTimers();
  });

  it("applies the same swing offset to every loop iteration, with no accumulated drift across the loop boundary", () => {
    vi.useFakeTimers();
    const { runtime, scheduled, advance } = fakeRuntime();
    let project = setBpm(createInitialProject(), 120);
    project = setSwing(project, 0.75);
    project = addAsset(project, makeAsset(1, "kick.wav"));
    project = assignAsset(project, "track-1", 1);
    project = addNote(project, project.patterns[0].id, "track-1", 1); // 1 bar @16 beats/bar = 2s loop @120bpm

    const transport = new Transport(runtime, () => project, noBus);
    transport.play();
    expect(scheduled).toHaveLength(1);

    advance(2.0); // exactly one loop later
    vi.advanceTimersByTime(25);
    expect(scheduled.length).toBeGreaterThanOrEqual(2);
    // Both iterations' swing offset is identical, so the gap between them is exactly one
    // straight loop length — swing never shifts where the next loop starts.
    expect(scheduled[1].time - scheduled[0].time).toBeCloseTo(2.0, 5);

    transport.stop();
    vi.useRealTimers();
  });

  it("recalculates the swing offset relative to the current BPM, not a fixed time", () => {
    vi.useFakeTimers();
    const { runtime, scheduled } = fakeRuntime();
    let project = setBpm(createInitialProject(), 60); // half tempo -> double the 16th duration
    project = setSwing(project, 0.75);
    project = addAsset(project, makeAsset(1, "kick.wav"));
    project = assignAsset(project, "track-1", 1);
    project = addNote(project, project.patterns[0].id, "track-1", 1);

    const transport = new Transport(runtime, () => project, noBus);
    transport.play();
    const spbSlow = secondsPerBeat(60);
    expect(scheduled[0].time).toBeCloseTo(0.05 + 1 * spbSlow + spbSlow * 0.25, 10);

    transport.stop();
    vi.useRealTimers();
  });

  it("retime() re-anchors a live swing change onto the already-running schedule", () => {
    vi.useFakeTimers();
    const { runtime, scheduled } = fakeRuntime();
    let project = setBpm(createInitialProject(), 120);
    project = addAsset(project, makeAsset(1, "kick.wav"));
    project = assignAsset(project, "track-1", 1);
    project = addNote(project, project.patterns[0].id, "track-1", 1);

    const transport = new Transport(runtime, () => project, noBus);
    transport.play();
    expect(scheduled[0].time).toBeCloseTo(0.05 + 1 * spb, 10); // default swing is 50% (straight)

    project = setSwing(project, 0.75); // same reference the transport reads via getProject()
    transport.retime();

    const latest = scheduled[scheduled.length - 1];
    expect(latest.time).toBeCloseTo(0.05 + 1 * spb + spb * 0.25, 5);

    transport.stop();
    vi.useRealTimers();
  });
});

describe("Transport resampling", () => {
  it("armResample() refuses when nothing is playing", () => {
    const { runtime } = fakeRuntime();
    const transport = new Transport(runtime, () => singlePatternProject(), noBus);
    const result = transport.armResample();
    expect(result.ok).toBe(false);
  });

  it("armResample() refuses when the current pattern exceeds the engine's capture capacity", () => {
    vi.useFakeTimers();
    const { runtime } = fakeRuntime(/* maxCaptureSeconds */ 1); // pattern is 2s
    const project = singlePatternProject();
    const transport = new Transport(runtime, () => project, noBus);

    transport.play();
    const result = transport.armResample();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/capacity/i);

    transport.stop();
    vi.useRealTimers();
  });

  it("refuses a second resample while one is already in flight", () => {
    vi.useFakeTimers();
    const { runtime } = fakeRuntime();
    const project = singlePatternProject();
    const transport = new Transport(runtime, () => project, noBus);

    transport.play();
    const first = transport.armResample();
    expect(first.ok).toBe(true);
    if (first.ok) first.result.catch(() => {}); // stop() below abandons it — see cancelResample()
    expect(transport.armResample().ok).toBe(false);

    transport.stop();
    vi.useRealTimers();
  });

  it("arms the engine capture at the target pattern's next boundary, spanning exactly one iteration", () => {
    vi.useFakeTimers();
    const { runtime, armCaptureCalls, advance } = fakeRuntime();
    const project = singlePatternProject(); // 1 bar @120bpm = 2s per loop
    const transport = new Transport(runtime, () => project, noBus);

    transport.play(); // already scheduled this loop's iteration before we arm below
    const armed = transport.armResample();
    expect(armed.ok).toBe(true);
    if (armed.ok) armed.result.catch(() => {}); // stop() below abandons it — see cancelResample()
    expect(armCaptureCalls).toHaveLength(0); // waiting — nothing armed on the engine yet
    expect(transport.getResampleStatus()).toBe("armed");

    advance(2.0); // the loop's next iteration is now due to be scheduled
    vi.advanceTimersByTime(25);

    expect(armCaptureCalls).toHaveLength(1);
    expect(armCaptureCalls[0].stopTime - armCaptureCalls[0].startTime).toBeCloseTo(2.0, 5);
    expect(transport.getResampleStatus()).toBe("capturing");

    transport.stop();
    vi.useRealTimers();
  });

  it("on A -> A -> B -> C -> B with B active, captures only the next real B iteration, not the intervening C", () => {
    vi.useFakeTimers();
    const { runtime, armCaptureCalls, advance } = fakeRuntime();
    let project = setBpm(createInitialProject(), 120);
    project = addAsset(project, makeAsset(1, "kick.wav"));
    const a = project.patterns[0].id;
    project = assignAsset(project, "track-1", 1);
    project = addNote(project, a, "track-1", 0);
    project = addPattern(project, "Pattern B", 1); // 1 bar = 2s, same as A
    const b = project.patterns[1].id;
    project = addNote(project, b, "track-1", 0);
    project = addPattern(project, "Pattern C", 1);
    const c = project.patterns[2].id;
    project = addNote(project, c, "track-1", 0);

    project = appendToChain(project, a); // chain starts with one A already -> [A, A]
    project = appendToChain(project, b); // [A, A, B]
    project = appendToChain(project, c); // [A, A, B, C]
    project = appendToChain(project, b); // [A, A, B, C, B]

    const transport = new Transport(runtime, () => project, noBus);
    transport.play(); // schedules step 0 (A)

    // Advance a little past each 2s boundary (not exactly onto it) since every step's window
    // is itself offset by Transport's own lead-in — see play()'s doc comment — so "exactly
    // 2.0s later" would land squarely on a boundary edge rather than inside the next step.
    advance(2.05); // step 1 (A) becomes due
    vi.advanceTimersByTime(25);
    advance(2.05); // step 2 (the first B) becomes due and is now "currently active"
    vi.advanceTimersByTime(25);
    expect(transport.getPlayheadInfo().patternId).toBe(b);

    const armed = transport.armResample();
    expect(armed.ok).toBe(true);
    if (armed.ok) {
      expect(armed.patternId).toBe(b);
      armed.result.catch(() => {}); // stop() below abandons it — see cancelResample()
    }

    advance(2.05); // step 3 (C) becomes due -- must NOT trigger the capture
    vi.advanceTimersByTime(25);
    expect(armCaptureCalls).toHaveLength(0);

    advance(2.05); // step 4 (the second, real next B) becomes due -- this is the one to capture
    vi.advanceTimersByTime(25);
    expect(armCaptureCalls).toHaveLength(1);
    expect(armCaptureCalls[0].stopTime - armCaptureCalls[0].startTime).toBeCloseTo(2.0, 5);

    transport.stop();
    vi.useRealTimers();
  });

  it("resolves armResample()'s promise once the engine's capture settles", async () => {
    vi.useFakeTimers();
    const { runtime, advance, resolveLastArmCapture } = fakeRuntime();
    const project = singlePatternProject();
    const transport = new Transport(runtime, () => project, noBus);

    transport.play();
    const armed = transport.armResample();
    expect(armed.ok).toBe(true);
    if (!armed.ok) return;

    advance(2.0);
    vi.advanceTimersByTime(25);

    const channelData = [new ArrayBuffer(8)];
    resolveLastArmCapture(fakeSampleMetadata, channelData);
    const settled = await armed.result;
    expect(settled.metadata).toEqual(fakeSampleMetadata);
    expect(settled.channelData).toBe(channelData);
    expect(transport.getResampleStatus()).toBe("idle");

    transport.stop();
    vi.useRealTimers();
  });

  it("retime() is a no-op while a resample is armed or capturing (BPM changes are frozen)", () => {
    vi.useFakeTimers();
    const { runtime, cancelScheduled } = fakeRuntime();
    const project = singlePatternProject();
    const transport = new Transport(runtime, () => project, noBus);

    transport.play();
    const armed = transport.armResample();
    if (armed.ok) armed.result.catch(() => {}); // stop() below abandons it — see cancelResample()
    cancelScheduled.mockClear();

    transport.retime();
    expect(cancelScheduled).not.toHaveBeenCalled();
    expect(transport.getResampleStatus()).toBe("armed"); // untouched, not reset by retime()

    transport.stop();
    vi.useRealTimers();
  });
});
