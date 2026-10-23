// What the host should play when a MIDI key is pressed, for a host that plays incoming MIDI itself (webdsp's runtime.setMidiRoute; see
// webdsp docs/midi-routing.md). It is the same mapping Playback.noteOn uses when the page plays the note, written as a route so the
// host can do it without the page: the selected track's sample (chromatic, or a chop slice per key, looping while held, mono) or its
// synth (a pitched synth sounds the key, a drum plays from middle C).
import type { InstrumentId, MidiRoute } from "webdsp";
import { instrumentDefFor, rootMidiNote } from "../model/instruments";
import { effectiveSampleMode } from "../model/chop";
import { effectiveChokeGroup, effectivePlaybackMode, effectiveVoiceMode } from "../model/types";
import type { Track } from "../model/types";
import { MIDI_UNITY_NOTE } from "./playback";

export interface RouteContext {
  /** The engine instrument that plays the track, if it has one yet (a synth track). */
  instrumentId?: InstrumentId;
  /** The track's bus, once the engine has one for it. */
  busId?: number;
  /** A resample is armed or capturing: it records the master output, so nothing may be played over it (Playback refuses too). */
  captureBusy: boolean;
}

/** The route for `track`, or null when nothing should play (no track, nothing assigned, no engine target yet, a resample under way). */
export function routeForTrack(track: Track | undefined, ctx: RouteContext): MidiRoute | null {
  if (!track || ctx.captureBusy) return null;
  const chokeGroup = effectiveChokeGroup(track);
  const choke = chokeGroup === null ? {} : { chokeGroup };

  if (track.instrument) {
    const def = instrumentDefFor(track);
    if (!def || ctx.instrumentId === undefined) return null;
    // A pitched synth sounds the key it is given (its root key plays its tune); a drum plays from middle C, like a sample.
    const root = def.category === "drum" ? null : rootMidiNote(track);
    return { kind: "instrument", id: ctx.instrumentId, unityNote: root === null ? MIDI_UNITY_NOTE : Math.round(root), holdUntilKeyUp: true, ...choke };
  }

  if (track.assetId == null || ctx.busId === undefined) return null;
  const loop = effectivePlaybackMode(track) === "loop";
  return {
    kind: "sample",
    id: track.assetId,
    bus: ctx.busId,
    unityNote: MIDI_UNITY_NOTE,
    ...(effectiveSampleMode(track) === "chop" ? { chop: true } : {}),
    ...(loop ? { loop: true, holdUntilKeyUp: true } : {}),
    ...(effectiveVoiceMode(track) === "mono" ? { mono: true } : {}),
    ...choke,
  };
}
