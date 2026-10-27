// The song as a webdsp Sequence, for a host that plays it itself (runtime.setSequence; webdsp docs/native-sequence.md): one cycle of the
// pattern queue as timed events in quarter notes. The host plays it on its audio thread against the DAW's transport, so it keeps playing
// with the plugin window closed and renders in an offline bounce. The page stays the editor: every edit sends the whole sequence again.
//
// This is not a second compiler. Every pattern step goes through the same compile functions the lookahead Transport uses
// (compilePatternIterationTracked, compileInstrumentNotes, simultaneousChokeLosers), at a fixed 120 bpm so that time in seconds is exactly
// time in quarter notes / 2; the result is converted to beats, so the host plays what Transport would have scheduled. What differs is
// only where tempo comes from: the DAW's, per block, not baked into the events.
import type { BusId, InstrumentId, Sequence, SequenceEvent, SequenceParamEvent } from "webdsp";
import type { FxTarget, Pattern, Project, TrackId } from "../model/types";
import { effectiveVoiceMode, resolveChainStep, totalBeats } from "../model/types";
import { applyLaneModifiers, automationAppliesTo, masterLaneIndex, songBeats, songInstances, type PlaybackSource } from "../model/composer";
import type { AutomationScope } from "./automation";
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
  /** Lane events for one step iteration (webseq beats from the cycle start) of the owners in `scope` (default: master and
   * every track); see automation.ts's automationSequenceEvents. */
  automation: (stepStartBeats: number, stepBeats: number, scope?: AutomationScope) => SequenceParamEvent[];
  /** What the sequence is of: the pattern queue (default) or the Composer song. In Song mode every lane's sequences are
   * laid out at their song positions, overlapping across lanes, and a gap is just the absence of events. */
  source?: PlaybackSource;
}

/** One cycle of the pattern queue as a Sequence, or null when there is nothing to play (no queue, no notes). Pure. */
export function compileNativeSequence(project: Project, ctx: NativeSequenceContext): Sequence | null {
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i] as const));
  const events: SequenceEvent[] = [];

  // The steps of one cycle, the same ones Transport schedules: the queue's, one after another (a dangling entry,
  // whose pattern was deleted, is skipped as Transport skips it), or the song's sequences at their positions.
  interface Step {
    pattern: Pattern;
    startBeat: number;
    beats: number;
    scope?: AutomationScope;
  }
  const steps: Step[] = [];
  let cycleBeats = 0; // webseq beats
  if (ctx.source === "song") {
    const instances = songInstances(project);
    const masterLane = masterLaneIndex(instances);
    for (const i of instances) {
      // The lane's modifiers are applied to the notes here, as Transport does, before the ordinary compile below. Track and
      // master automation replay from the start of each sequence they apply to, as in Transport.
      const tracks = new Set(project.tracks.map((t) => t.id).filter((id) => automationAppliesTo(i, id, masterLane)));
      steps.push({ pattern: applyLaneModifiers(i.pattern, i.modifiers), startBeat: i.startBeat, beats: i.beats, scope: { master: automationAppliesTo(i, "master", masterLane), tracks } });
    }
    cycleBeats = songBeats(project);
  } else {
    for (let i = 0; i < project.patternChain.length; i++) {
      const step = resolveChainStep(project, i);
      if (!step) continue;
      const beats = totalBeats(step.pattern, project.beatsPerBar);
      if (beats <= 0) continue;
      steps.push({ pattern: step.pattern, startBeat: cycleBeats, beats });
      cycleBeats += beats;
    }
  }

  for (const step of steps) {
    const { beats } = step;
    const startSeconds = step.startBeat * secondsPerBeat(REFERENCE_BPM);

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
    events.push(...ctx.automation(step.startBeat, beats, step.scope));
  }

  if (cycleBeats <= 0 || events.length === 0) return null;
  return { lengthBeats: cycleBeats / BEATS_PER_QUARTER, events };
}
