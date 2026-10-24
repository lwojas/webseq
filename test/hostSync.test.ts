import { describe, expect, it, vi } from "vitest";
import type { HostTransport } from "webdsp";
import { createHostSync } from "../src/audio/hostSync";

function setup(startTransport = true) {
  let now = 10;
  let listener: ((t: HostTransport) => void) | null = null;
  let status: "stopped" | "playing" | "paused" = "stopped";
  const calls: string[] = [];
  const playAt = vi.fn((beat: number, at: number, bpm: number) => {
    status = "playing";
    calls.push(`playAt(${beat.toFixed(3)}, ${at.toFixed(3)}, ${bpm})`);
  });
  const stop = vi.fn(() => {
    status = "stopped";
    calls.push("stop");
  });
  const transport = { getStatus: () => status, playAt, stop };
  const onChange = vi.fn();
  const sync = createHostSync({
    runtime: {
      getCurrentTime: () => now,
      getHostTransport: () => null,
      onHostTransport: (fn) => {
        listener = fn;
        return () => (listener = null);
      },
    },
    getTransport: () => (startTransport ? transport : null),
    onChange,
  });
  const emit = (t: Partial<HostTransport>) =>
    listener?.({ playing: true, bpm: 120, beat: 0, time: 10.1, loop: null, timeSignature: null, epoch: 1, ...t });
  return { sync, emit, playAt, stop, onChange, calls, setNow: (n: number) => (now = n), setStatus: (s: typeof status) => (status = s) };
}

describe("hostSync", () => {
  it("starts on the host's first beat at the host's time and tempo (quarter notes -> webseq beats)", () => {
    const { emit, calls } = setup();
    emit({ beat: 8, time: 10.1, bpm: 120 });
    expect(calls).toEqual(["playAt(32.000, 10.100, 120)"]); // beat 8 quarter notes = 32 sixteenths, heard at 10.1
  });

  it("when the event is already late, starts at the nearest future moment on the host's grid", () => {
    const { emit, calls, setNow } = setup();
    setNow(10.3);
    emit({ beat: 8, time: 10.1, bpm: 120 }); // 0.23 s after the mapping point: at = 10.33, beat = 8 + 0.23*2 = 8.46 quarters
    expect(calls).toEqual(["playAt(33.840, 10.330, 120)"]);
  });

  it("does not restart on the periodic refresh, but does on a locate (new epoch)", () => {
    const { emit, playAt } = setup();
    emit({ epoch: 1 });
    emit({ epoch: 1, beat: 0.2, time: 10.2 });
    expect(playAt).toHaveBeenCalledTimes(1);
    emit({ epoch: 2, beat: 64, time: 11 });
    expect(playAt).toHaveBeenCalledTimes(2);
  });

  it("re-anchors on a tempo change within the same epoch", () => {
    const { emit, calls, sync } = setup();
    emit({ epoch: 1, bpm: 120 });
    emit({ epoch: 1, bpm: 140, beat: 4, time: 12 });
    expect(calls[1]).toBe("playAt(16.000, 12.000, 140)");
    expect(sync.getFollowedBpm()).toBe(140);
  });

  it("stops when the host stops, only if it started the playback", () => {
    const a = setup();
    a.emit({ epoch: 1 });
    a.emit({ playing: false, epoch: 2 });
    expect(a.stop).toHaveBeenCalledTimes(1);
    expect(a.sync.getFollowedBpm()).toBeNull();

    const b = setup(); // the user started the transport by hand; the host was never playing
    b.setStatus("playing");
    b.emit({ playing: false, epoch: 1 });
    expect(b.stop).not.toHaveBeenCalled();
  });

  it("respects a user Stop during host playback until the host jumps or restarts", () => {
    const { emit, playAt, setStatus } = setup();
    emit({ epoch: 1 });
    setStatus("stopped"); // user pressed Stop
    emit({ epoch: 1, beat: 1, time: 10.5 }); // refresh
    expect(playAt).toHaveBeenCalledTimes(1);
    emit({ epoch: 2, beat: 0, time: 12 }); // host locates
    expect(playAt).toHaveBeenCalledTimes(2);
  });

  it("applies a start that arrived before the transport existed", () => {
    let exists = false;
    let listener: ((t: HostTransport) => void) | null = null;
    const playAt = vi.fn();
    createHostSync({
      runtime: { getCurrentTime: () => 0, getHostTransport: () => null, onHostTransport: (fn) => ((listener = fn), () => {}) },
      getTransport: () => (exists ? { getStatus: () => "stopped", playAt, stop: vi.fn() } : null),
      onChange: () => {},
    });
    const t: HostTransport = { playing: true, bpm: 120, beat: 0, time: 1, loop: null, timeSignature: null, epoch: 1 };
    listener!(t);
    expect(playAt).not.toHaveBeenCalled();
    exists = true;
    listener!({ ...t, beat: 0.5, time: 1.25 }); // the next refresh catches up
    expect(playAt).toHaveBeenCalledTimes(1);
  });
});

describe("hostSync with a native sequence", () => {
  function nativeSetup() {
    let listener: ((t: HostTransport) => void) | null = null;
    const calls: string[] = [];
    const transport = {
      getStatus: () => "stopped" as const,
      playAt: vi.fn(() => calls.push("playAt")),
      stop: vi.fn(),
      attachHost: vi.fn((t: HostTransport) => calls.push(`attach(${t.beat})`)),
      detachHost: vi.fn(() => calls.push("detach")),
    };
    const onChange = vi.fn();
    createHostSync({
      runtime: { getCurrentTime: () => 10, getHostTransport: () => null, onHostTransport: (fn) => ((listener = fn), () => (listener = null)) },
      getTransport: () => transport,
      native: true,
      onChange,
    });
    const emit = (t: Partial<HostTransport>) => listener?.({ playing: true, bpm: 120, beat: 0, time: 10.1, loop: null, timeSignature: null, epoch: 1, ...t });
    return { emit, calls, transport, onChange };
  }

  it("never schedules from the page: it follows the host's position while it plays and lets go when it stops", () => {
    const { emit, calls, transport, onChange } = nativeSetup();
    emit({ beat: 8 });
    emit({ beat: 8.5, time: 10.3 }); // a refresh: the mapping is passed on, nothing restarts
    emit({ playing: false });
    expect(calls).toEqual(["attach(8)", "attach(8.5)", "detach"]);
    expect(transport.playAt).not.toHaveBeenCalled();
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([120, null]);
  });
});
