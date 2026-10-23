import { describe, expect, it } from "vitest";
import { routeForTrack } from "../src/audio/midiRoute";
import { addAsset, assignAsset, createInitialProject, setTrackPlaybackMode, setTrackVoiceMode } from "../src/model/project";
import { setTrackInstrument } from "../src/model/instruments";
import { setTrackChokeGroup } from "../src/model/project";
import { MIDI_UNITY_NOTE } from "../src/audio/playback";
import { trackById } from "../src/model/types";
import type { Asset } from "../src/model/types";

const asset = (id: number): Asset => ({ id, name: "k.wav", type: "audio", duration: 1, sampleRate: 48000, channels: 2, origin: "import" });
const ctx = { instrumentId: 3, busId: 11, captureBusy: false };

function withSample(mutate: (p: ReturnType<typeof createInitialProject>) => ReturnType<typeof createInitialProject> = (p) => p) {
  let project = addAsset(createInitialProject(), asset(5));
  project = assignAsset(project, "track-1", 5);
  project = mutate(project);
  return trackById(project, "track-1")!;
}

describe("routeForTrack", () => {
  it("plays nothing without a track, with nothing assigned, without an engine target yet, or during a resample", () => {
    expect(routeForTrack(undefined, ctx)).toBeNull();
    expect(routeForTrack(trackById(createInitialProject(), "track-1"), ctx)).toBeNull(); // empty track
    expect(routeForTrack(withSample(), { ...ctx, busId: undefined })).toBeNull(); // no bus yet
    expect(routeForTrack(withSample(), { ...ctx, captureBusy: true })).toBeNull();
    const synth = trackById(setTrackInstrument(createInitialProject(), "track-1", "kick"), "track-1")!;
    expect(routeForTrack(synth, { ...ctx, instrumentId: undefined })).toBeNull(); // not created yet
  });

  it("a sample track plays its asset chromatically from middle C on its own bus, one-shot", () => {
    expect(routeForTrack(withSample(), ctx)).toEqual({ kind: "sample", id: 5, bus: 11, unityNote: MIDI_UNITY_NOTE });
  });

  it("a looping track holds until key-up, a mono one is monophonic, a choke group is carried", () => {
    const route = routeForTrack(
      withSample((p) => setTrackChokeGroup(setTrackVoiceMode(setTrackPlaybackMode(p, "track-1", "loop"), "track-1", "mono"), "track-1", 2)),
      ctx,
    );
    expect(route).toMatchObject({ kind: "sample", id: 5, loop: true, holdUntilKeyUp: true, mono: true, chokeGroup: 2 });
  });

  it("a drum synth plays from middle C and a pitched synth sounds the key itself, both released on key-up", () => {
    const kick = trackById(setTrackInstrument(createInitialProject(), "track-1", "kick"), "track-1")!;
    expect(routeForTrack(kick, ctx)).toEqual({ kind: "instrument", id: 3, unityNote: MIDI_UNITY_NOTE, holdUntilKeyUp: true });

    const bass = trackById(setTrackInstrument(createInitialProject(), "track-1", "bass"), "track-1")!;
    const route = routeForTrack(bass, ctx)!;
    expect(route.kind).toBe("instrument");
    expect(route.unityNote).not.toBe(MIDI_UNITY_NOTE); // the bass's root key, from its tune
    expect(route.unityNote).toBeGreaterThan(20);
    expect(route.unityNote).toBeLessThan(60);
  });
});
