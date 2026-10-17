import { describe, expect, it } from "vitest";
import { InstrumentKind } from "webdsp";
import { syncBuses } from "../src/audio/busSync";
import { instrumentHostFor } from "../src/audio/instruments";
import { compileInstrumentNotes, compileNote } from "../src/audio/compile";
import { Playback } from "../src/audio/playback";
import { createInitialProject, assignAsset, addAsset, addNote, setNotePitch } from "../src/model/project";
import { INSTRUMENT_DEFS, rootMidiNote, setInstrumentParam, setTrackInstrument } from "../src/model/instruments";
import { pasteTrackConfig, copyTrackConfig } from "../src/model/trackConfig";
import { mockRuntime } from "./mockRuntime";

const buses = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`track-${i + 1}`, i + 1]));

describe("instrument model", () => {
  it("setting a synth clears the sample, and assigning a sample clears the synth", () => {
    let project = createInitialProject();
    project = addAsset(project, { id: 5, name: "loop", type: "audio", duration: 1, sampleRate: 48000, channels: 1, origin: "import" });
    project = assignAsset(project, "track-1", 5);
    project = setTrackInstrument(project, "track-1", "kick");
    expect(project.tracks[0].assetId).toBeNull();
    expect(project.tracks[0].instrument?.kind).toBe("kick");
    expect(project.tracks[0].name).toBe("Kick");

    project = assignAsset(project, "track-1", 5);
    expect(project.tracks[0].instrument).toBeNull();
    expect(project.tracks[0].assetId).toBe(5);
  });

  it("re-selecting the same kind keeps tweaked params; a new kind resets to defaults", () => {
    let project = setTrackInstrument(createInitialProject(), "track-1", "kick");
    project = setInstrumentParam(project, "track-1", "decay", 1.2);
    expect(setTrackInstrument(project, "track-1", "kick").tracks[0]).toBe(project.tracks[0]);
    const snare = setTrackInstrument(project, "track-1", "snare");
    expect(snare.tracks[0].instrument?.params.decay).toBe(0.22);
  });

  it("clamps params to their range and ignores unknown ones", () => {
    let project = setTrackInstrument(createInitialProject(), "track-1", "kick");
    project = setInstrumentParam(project, "track-1", "decay", 99);
    expect(project.tracks[0].instrument?.params.decay).toBe(2);
    expect(setInstrumentParam(project, "track-1", "nope", 1).tracks[0]).toBe(project.tracks[0]);
  });

  it("copy/paste of track config carries the synth and pan by value", () => {
    let project = setTrackInstrument(createInitialProject(), "track-1", "bass");
    project = setInstrumentParam(project, "track-1", "cutoff", 900);
    const copied = copyTrackConfig(project.tracks[0]);
    const pasted = pasteTrackConfig(project, "track-2", copied);
    expect(pasted.tracks[1].instrument).toEqual(project.tracks[0].instrument);
    expect(pasted.tracks[1].instrument).not.toBe(project.tracks[0].instrument);
    expect(pasted.tracks[1].name).toBe("Bass");
  });
});

describe("note pitch", () => {
  it("stores whole semitones, clamped, and removes the field at 0", () => {
    let project = createInitialProject();
    const patternId = project.patterns[0].id;
    project = addNote(project, patternId, "track-1", 0);
    const noteId = Object.keys(project.patterns[0].notes)[0];
    project = setNotePitch(project, patternId, noteId, 7.4);
    expect(project.patterns[0].notes[noteId].pitch).toBe(7);
    project = setNotePitch(project, patternId, noteId, 100);
    expect(project.patterns[0].notes[noteId].pitch).toBe(48);
    project = setNotePitch(project, patternId, noteId, 0);
    expect("pitch" in project.patterns[0].notes[noteId]).toBe(false);
  });

  it("is forwarded to sample events as pitch", () => {
    let project = addAsset(createInitialProject(), { id: 5, name: "s", type: "audio", duration: 1, sampleRate: 48000, channels: 1, origin: "import" });
    project = assignAsset(project, "track-1", 5);
    const note = { id: "n", trackId: "track-1", start: 0, duration: 1, velocity: 1, pitch: -5 };
    expect(compileNote(project.tracks[0], note, 120, 0)?.pitch).toBe(-5);
  });
});

describe("InstrumentHost", () => {
  it("creates an instance routed to the track bus and pushes params by engine name", () => {
    const { runtime, calls } = mockRuntime();
    let project = setTrackInstrument(createInitialProject(), "track-4", "kick");
    project = setInstrumentParam(project, "track-4", "decay", 0.9);
    syncBuses(runtime, project, buses);
    expect(calls.createInstrument).toEqual([{ kind: InstrumentKind.Kick, bus: 4, id: 1 }]);
    // "decay" is index 3 in the mock kick table.
    expect(calls.setInstrumentParameter.find(([, p]) => p === 3)?.[2]).toBe(0.9);
  });

  it("recreates on a kind change, and removes when the synth goes away", () => {
    const { runtime, calls } = mockRuntime();
    let project = setTrackInstrument(createInitialProject(), "track-1", "kick");
    syncBuses(runtime, project, buses);
    project = setTrackInstrument(project, "track-1", "snare");
    syncBuses(runtime, project, buses);
    expect(calls.removeInstrument).toEqual([1]);
    expect(calls.createInstrument.map((c) => c.kind)).toEqual([InstrumentKind.Kick, InstrumentKind.Snare]);
    project = setTrackInstrument(project, "track-1", null);
    syncBuses(runtime, project, buses);
    expect(calls.removeInstrument).toEqual([1, 2]);
  });

  it("does not recreate or re-push when nothing changed", () => {
    const { runtime, calls } = mockRuntime();
    const project = setTrackInstrument(createInitialProject(), "track-1", "kick");
    syncBuses(runtime, project, buses);
    const pushed = calls.setInstrumentParameter.length;
    syncBuses(runtime, project, buses);
    expect(calls.createInstrument).toHaveLength(1);
    expect(calls.setInstrumentParameter).toHaveLength(pushed);
  });

  it("stopAll note-offs every live instrument", () => {
    const { runtime, calls } = mockRuntime();
    syncBuses(runtime, setTrackInstrument(createInitialProject(), "track-1", "bass"), buses);
    instrumentHostFor(runtime).stopAll();
    expect(calls.instrumentNoteOff).toEqual([1]);
  });
});

describe("compileInstrumentNotes", () => {
  function projectWithNotes(kind: "kick" | "bass" | "pulse" | "pad" | "fm") {
    let project = setTrackInstrument(createInitialProject(), "track-1", kind);
    const patternId = project.patterns[0].id;
    project = addNote(project, patternId, "track-1", 4);
    const noteId = Object.keys(project.patterns[0].notes)[0];
    project = setNotePitch(project, patternId, noteId, 7);
    return project;
  }

  it("passes duration only for sustained kinds (bass), never for drums", () => {
    const spb = 60 / (120 * 4);
    const bass = projectWithNotes("bass");
    const [b] = compileInstrumentNotes(bass.patterns[0], bass.tracks, 120, 10);
    expect(b.params.duration).toBeCloseTo(1 * spb);
    expect(b.params.pitch).toBe(7);
    expect(b.params.time).toBeCloseTo(10 + 4 * spb);

    const kick = projectWithNotes("kick");
    const [k] = compileInstrumentNotes(kick.patterns[0], kick.tracks, 120, 10);
    expect(k.params.duration).toBeUndefined();
  });

  it("treats pulse as sustained, with the stepped rate defaulting to 1/4", () => {
    const spb = 60 / (120 * 4);
    const pulse = projectWithNotes("pulse");
    const [p] = compileInstrumentNotes(pulse.patterns[0], pulse.tracks, 120, 10);
    expect(p.params.duration).toBeCloseTo(1 * spb);
    expect(pulse.tracks[0].instrument?.params.rate).toBe(2);
    expect(pulse.tracks[0].instrument?.params.tune).toBe(110);
  });

  it("treats pad as sustained, with Pad's catalog defaults and an A2 root", () => {
    const spb = 60 / (120 * 4);
    const pad = projectWithNotes("pad");
    const [p] = compileInstrumentNotes(pad.patterns[0], pad.tracks, 120, 10);
    expect(p.params.duration).toBeCloseTo(1 * spb);
    expect(pad.tracks[0].instrument?.params).toEqual({
      tune: 110, tone: 0.5, movement: 0.5, detune: 0.4, space: 0.6, attack: 0.8, release: 3,
    });
    expect(rootMidiNote(pad.tracks[0])).toBeCloseTo(45);
  });

  it("exposes Filter Mod on bass (separate from bite) but not on pulse, whose repeat sets filter and drive", () => {
    const bass = projectWithNotes("bass");
    expect(bass.tracks[0].instrument?.params.filterMod).toBe(0.4);
    expect(INSTRUMENT_DEFS.bass.params.find((p) => p.id === "filterMod")?.label).toBe("Filter Mod");
    expect(INSTRUMENT_DEFS.pulse.params.some((p) => p.id === "filterMod")).toBe(false);
    expect(INSTRUMENT_DEFS.pad.params.some((p) => p.id === "filterMod")).toBe(false);
  });

  it("treats fm as sustained, with FM's catalog defaults and an A2 root", () => {
    const spb = 60 / (120 * 4);
    const fm = projectWithNotes("fm");
    const [p] = compileInstrumentNotes(fm.patterns[0], fm.tracks, 120, 10);
    expect(p.params.duration).toBeCloseTo(1 * spb);
    expect(fm.tracks[0].instrument?.params).toEqual({
      tune: 110, ratio: 1, timbre: 0.35, snap: 0.6, tone: 0.75, attack: 0.003, decay: 0.3,
      sustain: 0.6, release: 0.1, legato: 0, slide: 0,
    });
    expect(rootMidiNote(fm.tracks[0])).toBeCloseTo(45);
  });

  it("yields nothing for sample-only projects", () => {
    const project = addNote(createInitialProject(), createInitialProject().patterns[0].id, "track-1", 0);
    expect(compileInstrumentNotes(project.patterns[0], project.tracks, 120, 0)).toEqual([]);
  });
});

describe("Playback.pressTrack on a synth track", () => {
  it("plays one preview note, with a duration for sustained kinds only", () => {
    const { runtime, calls } = mockRuntime();
    const raw = runtime as unknown as { onVoiceEnded: () => void };
    raw.onVoiceEnded = () => {};
    let project = setTrackInstrument(createInitialProject(), "track-1", "bass");
    project = setTrackInstrument(project, "track-2", "kick");
    syncBuses(runtime, project, buses);
    const playback = new Playback(runtime, () => 1, () => false);
    expect(playback.pressTrack(project.tracks[0])).toBe(true);
    expect(playback.pressTrack(project.tracks[1])).toBe(true);
    expect(calls.instrumentNoteOn[0][1].duration).toBe(0.5);
    expect(calls.instrumentNoteOn[1][1].duration).toBeUndefined();
  });
});

describe("rootMidiNote", () => {
  it("maps a synth's Hz root to a MIDI note, and is null for samples", () => {
    const bass = setTrackInstrument(createInitialProject(), "track-1", "bass").tracks[0];
    expect(rootMidiNote(bass)).toBeCloseTo(33); // 55 Hz = A1
    const pulse = setTrackInstrument(createInitialProject(), "track-1", "pulse").tracks[0];
    expect(rootMidiNote(pulse)).toBeCloseTo(45); // 110 Hz = A2
    expect(rootMidiNote(createInitialProject().tracks[0])).toBeNull();
    expect(rootMidiNote(setTrackInstrument(createInitialProject(), "track-1", "hihat").tracks[0])).toBeNull();
  });
});
