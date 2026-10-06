import { describe, expect, it, vi } from "vitest";
import type { AudioRuntime, BusId, TriggerParams, VoiceHandle } from "webdsp";
import { AUDITION_GAIN, Playback } from "../src/audio/playback";
import { Transport } from "../src/audio/transport";
import { addAsset, assignAsset, createInitialProject, removeAsset, setTrackPlaybackMode, setTrackVoiceMode } from "../src/model/project";
import type { Asset, Project, TrackId } from "../src/model/types";
import { trackById } from "../src/model/types";

// Playback is exercised against a fake runtime: AudioContext isn't available under vitest.
function fakeRuntime() {
  let nextHandle = 1;
  const triggered: { handle: VoiceHandle; params: TriggerParams }[] = [];
  const released: VoiceHandle[] = [];
  const voiceEndedListeners: ((v: VoiceHandle) => void)[] = [];
  const runtime = {
    trigger: vi.fn((params: TriggerParams) => {
      const handle = nextHandle++;
      triggered.push({ handle, params });
      return handle;
    }),
    release: vi.fn((h: VoiceHandle) => released.push(h)),
    onVoiceEnded: vi.fn((fn: (v: VoiceHandle) => void) => {
      voiceEndedListeners.push(fn);
      return () => {};
    }),
    getCurrentTime: () => 0,
    schedule: vi.fn((events: { time: number }[]) => events.map(() => nextHandle++)),
    cancelScheduled: vi.fn(),
    getCapabilities: vi.fn(() => ({ sampleRate: 48000, outputChannels: 2, maxVoices: 64, renderQuantumFrames: 128, maxCaptureSeconds: 30 })),
  };
  return {
    runtime: runtime as unknown as AudioRuntime,
    triggered,
    released,
    endVoice: (h: VoiceHandle) => voiceEndedListeners.forEach((fn) => fn(h)),
  };
}

function makeAsset(id: number, name: string): Asset {
  return { id, name, type: "audio", duration: 1, sampleRate: 48000, channels: 2, origin: "import" };
}

/** Two assets, track-1 and track-2 both assigned, every track on its own bus (bus = 10 + index). */
function projectWithTracks(): Project {
  let project = createInitialProject();
  project = addAsset(project, makeAsset(1, "kick.wav"));
  project = addAsset(project, makeAsset(2, "snare.wav"));
  project = assignAsset(project, "track-1", 1);
  project = assignAsset(project, "track-2", 2);
  return project;
}

const busFor = (trackId: TrackId): BusId | undefined => {
  const index = Number(trackId.replace("track-", ""));
  return Number.isFinite(index) ? 10 + index : undefined;
};

function setup(opts: { busy?: boolean } = {}) {
  const fake = fakeRuntime();
  let busy = opts.busy ?? false;
  const playback = new Playback(fake.runtime, busFor, () => busy);
  return { ...fake, playback, setBusy: (v: boolean) => (busy = v) };
}

describe("audition", () => {
  it("plays the asset raw to master at the fixed audition gain", () => {
    const { playback, triggered } = setup();
    expect(playback.auditionAsset(1)).toBe(true);
    expect(triggered[0].params).toEqual({ sampleId: 1, gain: AUDITION_GAIN });
    expect(triggered[0].params.bus).toBeUndefined();
    expect(playback.snapshot().auditionAssetId).toBe(1);
  });

  it("stops when the same asset is tapped again", () => {
    const { playback, released, triggered } = setup();
    playback.auditionAsset(1);
    playback.auditionAsset(1);
    expect(released).toEqual([triggered[0].handle]);
    expect(playback.snapshot().auditionAssetId).toBeNull();
  });

  it("releases the current audition when a different asset starts", () => {
    const { playback, released, triggered } = setup();
    playback.auditionAsset(1);
    playback.auditionAsset(2);
    expect(released).toEqual([triggered[0].handle]);
    expect(playback.snapshot().auditionAssetId).toBe(2);
  });

  it("clears its active state when the voice ends on its own", () => {
    const { playback, endVoice, triggered } = setup();
    const seen: (number | null)[] = [];
    playback.subscribe((s) => seen.push(s.auditionAssetId));
    playback.auditionAsset(1);
    endVoice(triggered[0].handle);
    expect(playback.snapshot().auditionAssetId).toBeNull();
    expect(seen).toEqual([1, null]);
  });

  it("is refused while a resample is armed or capturing, without touching the engine", () => {
    const { playback, runtime, setBusy } = setup({ busy: true });
    expect(playback.auditionAsset(1)).toBe(false);
    expect(runtime.trigger).not.toHaveBeenCalled();
    setBusy(false);
    expect(playback.auditionAsset(1)).toBe(true);
  });
});

describe("track triggering", () => {
  it("one-shot on a poly track stacks: every press starts a voice and none are released", () => {
    const { playback, released, triggered } = setup();
    const project = projectWithTracks();
    const track = trackById(project, "track-1")!;
    playback.pressTrack(track);
    playback.pressTrack(track);
    expect(triggered).toHaveLength(2);
    expect(triggered[0].params).toEqual({ sampleId: 1, bus: 11 });
    expect(released).toEqual([]);
  });

  it("one-shot on a mono track chokes the previous voice", () => {
    const { playback, released, triggered } = setup();
    let project = projectWithTracks();
    project = setTrackVoiceMode(project, "track-1", "mono");
    const track = trackById(project, "track-1")!;
    playback.pressTrack(track);
    playback.pressTrack(track);
    expect(released).toEqual([triggered[0].handle]);
  });

  it("a loop track's press toggles a looping voice on and off", () => {
    const { playback, released, triggered } = setup();
    let project = projectWithTracks();
    project = setTrackPlaybackMode(project, "track-1", "loop");
    const track = trackById(project, "track-1")!;
    playback.pressTrack(track);
    expect(triggered[0].params).toEqual({ sampleId: 1, bus: 11, loop: true });
    expect(playback.snapshot().loopingTrackIds).toEqual(["track-1"]);
    playback.pressTrack(track);
    expect(released).toEqual([triggered[0].handle]);
    expect(playback.snapshot().loopingTrackIds).toEqual([]);
  });

  it("refuses a track with no asset or no bus", () => {
    const { playback, runtime } = setup();
    const project = projectWithTracks();
    const empty = trackById(project, "track-3")!;
    expect(playback.pressTrack(empty)).toBe(false);
    // An id busFor doesn't map to a bus (its suffix isn't a number).
    const noBusTrack = { ...trackById(project, "track-1")!, id: "lead" as TrackId };
    expect(playback.pressTrack(noBusTrack)).toBe(false);
    expect(runtime.trigger).not.toHaveBeenCalled();
  });

  it("is refused while a resample is armed or capturing, but a running loop can still be stopped", () => {
    const { playback, runtime, setBusy } = setup();
    let project = projectWithTracks();
    project = setTrackPlaybackMode(project, "track-1", "loop");
    const track = trackById(project, "track-1")!;
    playback.pressTrack(track);
    setBusy(true);
    expect(playback.pressTrack(trackById(projectWithTracks(), "track-2")!)).toBe(false);
    expect(playback.pressTrack(track)).toBe(true);
    expect(runtime.release).toHaveBeenCalledTimes(1);
  });
});

describe("shared mono choke", () => {
  it("a sequenced mono voice chokes a manual loop on the same track", () => {
    const { playback, released, triggered } = setup();
    let project = projectWithTracks();
    project = setTrackPlaybackMode(project, "track-1", "loop");
    project = setTrackVoiceMode(project, "track-1", "mono");
    playback.pressTrack(trackById(project, "track-1")!);
    const sequenced = 500;
    playback.registerMonoVoice("track-1", sequenced, "sequencer");
    expect(released).toEqual([triggered[0].handle]);
    expect(playback.snapshot().loopingTrackIds).toEqual([]);
  });

  it("a manual one-shot on a mono track chokes the sequenced voice", () => {
    const { playback, released } = setup();
    let project = projectWithTracks();
    project = setTrackVoiceMode(project, "track-1", "mono");
    playback.registerMonoVoice("track-1", 500, "sequencer");
    playback.pressTrack(trackById(project, "track-1")!);
    expect(released).toEqual([500]);
  });

  it("does not choke across different tracks", () => {
    const { playback, released } = setup();
    let project = projectWithTracks();
    project = setTrackVoiceMode(project, "track-1", "mono");
    playback.registerMonoVoice("track-2", 500, "sequencer");
    playback.pressTrack(trackById(project, "track-1")!);
    expect(released).toEqual([]);
  });

  it("dropSequencerVoices forgets sequenced entries, so the next mono voice chokes nothing", () => {
    const { playback, released, triggered } = setup();
    let project = projectWithTracks();
    project = setTrackVoiceMode(project, "track-1", "mono");
    playback.registerMonoVoice("track-1", 500, "sequencer");
    playback.dropSequencerVoices();
    playback.pressTrack(trackById(project, "track-1")!);
    expect(released).toEqual([]);
    playback.pressTrack(trackById(project, "track-1")!);
    expect(released).toEqual([triggered[0].handle]);
  });

  it("dropSequencerVoices keeps manual entries, so they still choke", () => {
    const { playback, released, triggered } = setup();
    let project = projectWithTracks();
    project = setTrackVoiceMode(project, "track-1", "mono");
    playback.pressTrack(trackById(project, "track-1")!);
    playback.dropSequencerVoices();
    playback.pressTrack(trackById(project, "track-1")!);
    expect(released).toEqual([triggered[0].handle]);
  });
});

describe("stopAll and reconcile", () => {
  it("stopAll silences auditions and manual loops but leaves sequenced voices to Transport", () => {
    const { playback, released, triggered } = setup();
    let project = projectWithTracks();
    project = setTrackPlaybackMode(project, "track-1", "loop");
    playback.pressTrack(trackById(project, "track-1")!);
    playback.auditionAsset(2);
    playback.registerMonoVoice("track-2", 500, "sequencer");
    playback.stopAll();
    expect(released).toEqual([triggered[0].handle, triggered[1].handle]);
    expect(playback.snapshot()).toEqual({ auditionAssetId: null, loopingTrackIds: [] });
  });

  it("releases a loop when its track is reassigned to a different asset", () => {
    const { playback, released, triggered } = setup();
    let project = projectWithTracks();
    project = setTrackPlaybackMode(project, "track-1", "loop");
    playback.pressTrack(trackById(project, "track-1")!);
    project = assignAsset(project, "track-1", 2);
    playback.reconcile(project);
    expect(released).toEqual([triggered[0].handle]);
    expect(playback.snapshot().loopingTrackIds).toEqual([]);
  });

  it("keeps a loop when reconciling an unchanged project", () => {
    const { playback, released } = setup();
    let project = projectWithTracks();
    project = setTrackPlaybackMode(project, "track-1", "loop");
    playback.pressTrack(trackById(project, "track-1")!);
    playback.reconcile(project);
    expect(released).toEqual([]);
    expect(playback.snapshot().loopingTrackIds).toEqual(["track-1"]);
  });

  it("stops an audition whose asset is removed from the bin", () => {
    const { playback, released, triggered } = setup();
    const project = projectWithTracks();
    playback.auditionAsset(1);
    playback.reconcile(removeAsset(project, 1));
    expect(released).toEqual([triggered[0].handle]);
    expect(playback.snapshot().auditionAssetId).toBeNull();
  });
});

describe("Transport integration", () => {
  it("Stop silences manual voices even when the transport was already stopped", () => {
    const fake = fakeRuntime();
    const playback = new Playback(fake.runtime, busFor, () => false);
    const transport = new Transport(fake.runtime, () => projectWithTracks(), busFor, playback);
    playback.auditionAsset(1);
    transport.stop();
    expect(fake.released).toEqual([fake.triggered[0].handle]);
    expect(playback.snapshot().auditionAssetId).toBeNull();
  });

  it("starting a resample silences auditions that are already sounding", () => {
    vi.useFakeTimers();
    const fake = fakeRuntime();
    const playback = new Playback(fake.runtime, busFor, () => false);
    const project = projectWithTracks();
    const transport = new Transport(fake.runtime, () => project, busFor, playback);
    transport.play();
    playback.auditionAsset(1);
    const armed = transport.armResample();
    if (!armed.ok) throw new Error(armed.reason);
    // transport.stop() below cancels the pending capture; expected, so swallow it here.
    armed.result.catch(() => {});
    expect(fake.released).toEqual([fake.triggered[0].handle]);
    expect(playback.snapshot().auditionAssetId).toBeNull();
    transport.stop();
    vi.useRealTimers();
  });
});
