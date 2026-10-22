import { describe, expect, it, vi } from "vitest";
import type { AudioRuntime, BusId, InstrumentNoteParams, TriggerParams, VoiceHandle } from "webdsp";
import { attachPlainMidiInputs, routeMidiMessage, type NoteSink } from "../src/midi/dawNoteInput";
import { MIDI_UNITY_NOTE, Playback } from "../src/audio/playback";
import { addAsset, assignAsset, createInitialProject, setTrackPlaybackMode } from "../src/model/project";
import { syncBuses } from "../src/audio/busSync";
import { setTrackInstrument } from "../src/model/instruments";
import { mockRuntime } from "./mockRuntime";
import type { Asset } from "../src/model/types";
import { trackById } from "../src/model/types";

function sink() {
  const calls: string[] = [];
  const s: NoteSink = {
    noteOn: (n, v) => calls.push(`on ${n} ${v.toFixed(2)}`),
    noteOff: (n) => calls.push(`off ${n}`),
    allNotesOff: () => calls.push("all off"),
  };
  return { s, calls };
}

describe("routeMidiMessage", () => {
  it("routes note on/off, treats velocity-0 note-on as off, and CC 123/120 as all-off", () => {
    const { s, calls } = sink();
    routeMidiMessage([0x90, 60, 127], s);
    routeMidiMessage([0x91, 64, 0], s);
    routeMidiMessage([0x80, 60, 0], s);
    routeMidiMessage([0xb0, 123, 0], s);
    routeMidiMessage([0xb0, 120, 0], s);
    routeMidiMessage([0xb0, 7, 90], s); // an ordinary CC is not a note
    routeMidiMessage([0xe0, 0, 64], s); // pitch bend is ignored
    expect(calls).toEqual(["on 60 1.00", "off 64", "off 60", "all off", "all off"]);
  });
});

describe("attachPlainMidiInputs", () => {
  function fakeInput(name: string) {
    const listeners = new Set<(e: Event) => void>();
    return {
      name,
      type: "input",
      state: "connected",
      addEventListener: (_: string, fn: (e: Event) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (e: Event) => void) => listeners.delete(fn),
      send: (data: number[]) => listeners.forEach((fn) => fn({ data: Uint8Array.from(data) } as unknown as Event)),
    };
  }

  it("listens to inputs no controller profile claims, and leaves Launchpad/Push alone", async () => {
    const daw = fakeInput("WebVST DAW MIDI");
    const launchpad = fakeInput("Launchpad Mini MK3 LPMiniMK3 MIDI Out");
    const push = fakeInput("Ableton Push User Port");
    const access = {
      inputs: new Map([["a", daw], ["b", launchpad], ["c", push]]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const { s, calls } = sink();
    const detach = attachPlainMidiInputs(s, async () => access as unknown as MIDIAccess);
    await new Promise((r) => setTimeout(r, 0));
    daw.send([0x90, 60, 100]);
    launchpad.send([0x90, 36, 100]);
    push.send([0x90, 36, 100]);
    expect(calls).toEqual(["on 60 0.79"]);
    detach();
    daw.send([0x90, 61, 100]);
    expect(calls).toEqual(["on 60 0.79", "all off"]); // detached: no more notes, held notes released
  });

  it("is silent when MIDI access is refused", async () => {
    const { s, calls } = sink();
    const detach = attachPlainMidiInputs(s, () => Promise.reject(new Error("denied")));
    await new Promise((r) => setTimeout(r, 0));
    detach();
    expect(calls).toEqual(["all off"]);
  });
});

describe("Playback key methods", () => {
  function setup() {
    let nextHandle = 1;
    const triggered: TriggerParams[] = [];
    const released: VoiceHandle[] = [];
    const notes: { id: number; params: InstrumentNoteParams }[] = [];
    const noteOffs: number[] = [];
    const runtime = {
      trigger: vi.fn((p: TriggerParams) => (triggered.push(p), nextHandle++)),
      release: vi.fn((h: VoiceHandle) => released.push(h)),
      onVoiceEnded: vi.fn(() => () => {}),
      instrumentNoteOn: vi.fn((id: number, params: InstrumentNoteParams) => notes.push({ id, params })),
      instrumentNoteOff: vi.fn((id: number) => noteOffs.push(id)),
      getCapabilities: vi.fn(() => ({ instruments: [] })),
    } as unknown as AudioRuntime;
    const busFor = (): BusId => 10;
    const playback = new Playback(runtime, busFor, () => false);
    let project = createInitialProject();
    project = addAsset(project, { id: 1, name: "k.wav", type: "audio", duration: 1, sampleRate: 48000, channels: 2, origin: "import" } as Asset);
    project = assignAsset(project, "track-1", 1);
    return { playback, project, triggered, released, notes, noteOffs, runtime };
  }

  it("plays a sample track chromatically, middle C at its own pitch, velocity as gain", () => {
    const { playback, project, triggered } = setup();
    const track = trackById(project, "track-1")!;
    expect(playback.noteOn(track, MIDI_UNITY_NOTE, 1)).toBe(true);
    expect(playback.noteOn(track, MIDI_UNITY_NOTE + 7, 0.5)).toBe(true);
    expect(triggered[0]).toMatchObject({ sampleId: 1, bus: 10, gain: 1 });
    expect(triggered[0].pitch).toBeUndefined();
    expect(triggered[1]).toMatchObject({ gain: 0.5, pitch: 7 });
  });

  it("releases a looping track's voice on key-up but lets a one-shot ring out", () => {
    const { playback, project, released } = setup();
    const oneShot = trackById(project, "track-1")!;
    playback.noteOn(oneShot, 60, 1);
    playback.noteOff(oneShot, 60);
    expect(released).toEqual([]);

    const looping = trackById(setTrackPlaybackMode(project, "track-1", "loop"), "track-1")!;
    playback.noteOn(looping, 62, 1);
    playback.noteOff(looping, 62);
    expect(released).toHaveLength(1);
  });

  it("is refused while a resample is capturing", () => {
    const fake = setup();
    const busy = new Playback(fake.runtime, () => 10, () => true);
    expect(busy.noteOn(trackById(fake.project, "track-1")!, 60, 1)).toBe(false);
  });
});

describe("Playback key methods on synth tracks", () => {
  const buses = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`track-${i + 1}`, i + 1]));

  it("plays a drum from middle C and a pitched synth on the key itself, and sends note-off for the held key only", () => {
    const { runtime, calls } = mockRuntime();
    let project = setTrackInstrument(createInitialProject(), "track-1", "kick");
    project = setTrackInstrument(project, "track-2", "bass");
    syncBuses(runtime, project, buses);
    (runtime as unknown as { onVoiceEnded: () => () => void }).onVoiceEnded = () => () => {};
    const playback = new Playback(runtime, (id) => buses[id as keyof typeof buses], () => false);

    const kick = trackById(project, "track-1")!;
    expect(playback.noteOn(kick, 60, 1)).toBe(true);
    expect(calls.instrumentNoteOn[0][1].pitch).toBeUndefined(); // middle C = the kick as tuned
    playback.noteOn(kick, 62, 1);
    expect(calls.instrumentNoteOn[1][1].pitch).toBe(2);

    const bass = trackById(project, "track-2")!;
    const rootKey = Math.round(69 + 12 * Math.log2((bass.instrument!.params.tune ?? 55) / 440));
    playback.noteOn(bass, rootKey + 5, 0.8);
    expect(calls.instrumentNoteOn[2][1]).toMatchObject({ velocity: 0.8, pitch: 5 });

    playback.noteOn(bass, rootKey + 7, 0.8); // a newer key replaces it on this monophonic track
    playback.noteOff(bass, rootKey + 5); // the older key's release must not cut the newer note
    expect(calls.instrumentNoteOff).toEqual([]);
    playback.noteOff(bass, rootKey + 7);
    expect(calls.instrumentNoteOff).toHaveLength(1);
  });
});
