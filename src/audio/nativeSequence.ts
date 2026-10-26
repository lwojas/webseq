// The song as a webdsp Sequence, for a host that plays it itself (runtime.setSequence; webdsp docs/native-sequence.md): one cycle of the
// pattern queue as timed events in quarter notes. The host plays it on its audio thread against the DAW's transport, so it keeps playing
// with the plugin window closed and renders in an offline bounce. The page stays the editor: every edit sends the whole sequence again.
//
// This is not a second compiler. Every pattern step goes through the same compile functions the lookahead Transport uses
// (compilePatternIterationTracked, compileInstrumentNotes, simultaneousChokeLosers), at a fixed 120 bpm so that time in seconds is exactly
// time in quarter notes / 2; the result is converted to beats, so the host plays what Transport would have scheduled. What differs is
// only where tempo comes from: the DAW's, per block, not baked into the events.
import type { BusId, InstrumentId, Sequence, SequenceEvent, SequenceParamEvent } from "webdsp";
import type { FxTarget, Project, TrackId } from "../model/types";
import { effectiveVoiceMode, resolveChainStep, totalBeats } from "../model/types";
import { compileInstrumentNotes, compilePatternIterationTracked, secondsPerBeat, simultaneousChokeLosers } from "./compile";

/** webseq beats are sixteenth steps; the host's positions are quarter notes. */
const BEATS_PER_QUARTER = 4;
/** The tempo the compile functions run at: 120 bpm makes a second exactly 2 quarter notes. */
const REFERENCE_BPM = 120;
const QUARTERS_PER_SECOND = REFERENCE_BPM / 60;

export interface NativeSequenceContext {
  getBusId: (target: FxTarget) => BusId | undefined;
  /** The engine instrument that plays this synth track's chord tone `voice`, if it exists yet. */
  instrumentIdFor: (trackId: TrackId, voice: number) => InstrumentId | undefined;
  /** Is this sample loaded in the engine? Events for a sample it does not have are left out (the sequence is sent again when it does). */
  hasSample: (sampleId: number) => boolean;
  /** Lane events for one step iteration (webseq beats from the cycle start); see automation.ts's automationSequenceEvents. */
  automation: (stepStartBeats: number, stepBeats: number) => SequenceParamEvent[];
}

/** One cycle of the pattern queue as a Sequence, or null when there is nothing to play (no queue, no notes). Pure. */
export function compileNativeSequence(project: Project, ctx: NativeSequenceContext): Sequence | null {
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i] as const));
  const events: SequenceEvent[] = [];
  let cycleBeats = 0; // webseq beats

  for (let i = 0; i < project.patternChain.length; i++) {
    const step = resolveChainStep(project, i);
    if (!step) continue; // a dangling entry (deleted pattern): Transport skips it too
    const beats = totalBeats(step.pattern, project.beatsPerBar);
    if (beats <= 0) continue;
    const startSeconds = cycleBeats * secondsPerBeat(REFERENCE_BPM);

    let samples = compilePatternIterationTracked(step.pattern, project.tracks, REFERENCE_BPM, startSeconds, (id) => ctx.getBusId(id), project.swing, 0, project.beatsPerBar, project.scale);
    let notes = compileInstrumentNotes(step.pattern, project.tracks, REFERENCE_BPM, startSeconds, project.swing, 0, project.beatsPerBar, project.scale);
    const losers = simultaneousChokeLosers(project.tracks, [
      ...samples.map((c) => ({ trackId: c.trackId, time: c.event.time })),
      ...notes.map((n) => ({ trackId: n.trackId, time: n.params.time ?? 0 })),
    ]);
    if (losers.some(Boolean)) {
      const count = samples.length;
      samples = samples.filter((_, k) => !losers[k]);
      notes = notes.filter((_, k) => !losers[count + k]);
    }

    for (const { event, trackId } of samples) {
      if (!ctx.hasSample(event.sampleId)) continue;
      const track = project.tracks.find((t) => t.id === trackId);
      const mono = track !== undefined && effectiveVoiceMode(track) === "mono";
      events.push({
        beat: event.time * QUARTERS_PER_SECOND,
        kind: "sample",
        sample: event.sampleId,
        ...(event.bus !== undefined ? { bus: event.bus } : {}),
        ...(event.gain !== undefined ? { gain: event.gain } : {}),
        ...(event.pan ? { pan: event.pan } : {}),
        ...(event.pitch ? { pitch: event.pitch } : {}),
        ...(event.region !== undefined ? { region: event.region } : {}),
        ...(event.loop ? { loop: true } : {}),
        ...(event.duration !== undefined ? { durationBeats: event.duration * QUARTERS_PER_SECOND } : {}),
        ...(event.chokeGroup !== undefined ? { chokeGroup: event.chokeGroup } : {}),
        ...(mono ? { mono: true, track: trackIndex.get(trackId) } : {}),
      });
    }
    for (const { trackId, params, voice } of notes) {
      const instrument = ctx.instrumentIdFor(trackId, voice);
      if (instrument === undefined) continue;
      events.push({
        beat: (params.time ?? 0) * QUARTERS_PER_SECOND,
        kind: "instrument",
        instrument,
        ...(params.velocity !== undefined ? { velocity: params.velocity } : {}),
        ...(params.pan ? { pan: params.pan } : {}),
        ...(params.pitch ? { pitch: params.pitch } : {}),
        ...(params.duration !== undefined ? { durationBeats: params.duration * QUARTERS_PER_SECOND } : {}),
        ...(params.chokeGroup !== undefined ? { chokeGroup: params.chokeGroup } : {}),
        ...(params.tie ? { tie: true } : {}),
      });
    }
    events.push(...ctx.automation(cycleBeats, beats));
    cycleBeats += beats;
  }

  if (cycleBeats <= 0 || events.length === 0) return null;
  return { lengthBeats: cycleBeats / BEATS_PER_QUARTER, events };
}
