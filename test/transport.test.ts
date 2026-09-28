import { describe, expect, it, vi } from "vitest";
import type { AudioRuntime, ScheduledEvent, VoiceHandle } from "webdsp";
import { Transport } from "../src/audio/transport";
import { addNote, assignSample, createInitialState } from "../src/model/pattern";
import type { SequencerState } from "../src/model/types";

// AudioRuntime needs a real browser (AudioContext/AudioWorklet) — not available under
// Node/vitest — so, like webdsp's own LookaheadPlayer test, Transport's scheduling logic
// is exercised against a faked runtime instead. This is exactly the seam
// ARCHITECTURE.md (webdsp) describes as "deliberately not unit-tested" for AudioRuntime
// itself, while still being fully testable one layer up.
function fakeRuntime() {
  let time = 0;
  let nextHandle = 1;
  const scheduled: ScheduledEvent[] = [];
  const released: VoiceHandle[] = [];
  const runtime = {
    getCurrentTime: () => time,
    schedule: vi.fn((events: ScheduledEvent[]) => {
      scheduled.push(...events);
      return events.map(() => nextHandle++);
    }),
    cancelScheduled: vi.fn(),
    release: vi.fn((h: VoiceHandle) => released.push(h)),
  };
  return {
    runtime: runtime as unknown as AudioRuntime,
    scheduled,
    released,
    cancelScheduled: runtime.cancelScheduled,
    advance: (dt: number) => (time += dt),
  };
}

function patternWithOneNotePerBar(): SequencerState {
  let state = createInitialState(16, 16, 1, 120); // 16 beats/bar, 1 bar -> 2s per loop @120bpm
  state = assignSample(state, "track-1", 1, "kick.wav");
  state = addNote(state, "track-1", 0);
  return state;
}

describe("Transport", () => {
  it("schedules the first loop iteration on play()", () => {
    vi.useFakeTimers();
    const { runtime, scheduled } = fakeRuntime();
    const state = patternWithOneNotePerBar();
    const transport = new Transport(runtime, () => state);

    transport.play(0);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].sampleId).toBe(1);

    transport.stop();
    vi.useRealTimers();
  });

  it("loops: tops up the next iteration once the lookahead window reaches it", () => {
    vi.useFakeTimers();
    const { runtime, scheduled, advance } = fakeRuntime();
    const state = patternWithOneNotePerBar(); // one loop = 16 * 0.125s = 2s
    const transport = new Transport(runtime, () => state);

    transport.play(0);
    expect(scheduled).toHaveLength(1); // only loop 0 is within the initial lookahead

    advance(2.0); // now at the loop boundary
    vi.advanceTimersByTime(25);
    expect(scheduled.length).toBeGreaterThanOrEqual(2); // loop 1 has been scheduled too

    transport.stop();
    vi.useRealTimers();
  });

  it("derives the playhead from the engine clock and wraps at the loop boundary", () => {
    vi.useFakeTimers();
    const { runtime, advance } = fakeRuntime();
    const state = patternWithOneNotePerBar();
    const transport = new Transport(runtime, () => state);

    // play() anchors playback 0.05s into the future (scheduling headroom, same as
    // webdsp's own LookaheadPlayer) — advance past that lead-in before asserting a beat.
    const LEAD_IN = 0.05;
    transport.play(0);
    advance(LEAD_IN + 0.125); // one beat past the lead-in
    expect(transport.getPlayheadBeat()).toBeCloseTo(1, 5);

    advance(2.0); // one full loop further -> wraps back to the same phase
    expect(transport.getPlayheadBeat()).toBeCloseTo(1, 5);

    transport.stop();
    vi.useRealTimers();
  });

  it("stop() cancels not-yet-fired events and releases active voices", () => {
    vi.useFakeTimers();
    const { runtime, cancelScheduled, released } = fakeRuntime();
    const state = patternWithOneNotePerBar();
    const transport = new Transport(runtime, () => state);

    transport.play(0);
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
    const state = patternWithOneNotePerBar();
    const transport = new Transport(runtime, () => state);

    transport.play(0);
    advance(0.05 + 0.5); // past the 0.05s lead-in, then 4 beats in
    transport.pause();
    expect(transport.getStatus()).toBe("paused");
    expect(transport.getPlayheadBeat()).toBeCloseTo(4, 4);

    transport.play(); // resume, no explicit beat argument
    expect(transport.getPlayheadBeat()).toBeCloseTo(4, 4);

    transport.stop();
    vi.useRealTimers();
  });
});
