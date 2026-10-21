// Audio for the Musical Guide: hear the scale, a note, or a recipe before applying it.
//
// No second engine and no scheduler branch. A preview is built as an ordinary little pattern on
// throwaway synth tracks, compiled by the same compileInstrumentNotes the sequencer uses (chords,
// pitch, velocity included) and played through an InstrumentHost — the same class that voices
// real synth tracks — on the one shared AudioRuntime. The host is private to the preview, so it
// never touches the project's own instruments, and stopping simply removes its instances (which
// also drops their pending notes). The project is never modified.

import { MASTER_BUS, type AudioRuntime } from "webdsp";
import { INSTRUMENT_DEFS, setTrackInstrument } from "../model/instruments";
import { createInitialProject } from "../model/project";
import type { ProjectScale } from "../model/scale";
import type { InstrumentKindId, Pattern, Project } from "../model/types";
import { resolveRecipeTrack } from "../guide/resolve";
import type { RecipeTrack } from "../guide/recipes";
import { compileInstrumentNotes, secondsPerBeat } from "./compile";
import { InstrumentHost } from "./instruments";

/** Used when a part names no instrument (or one the registry lacks). */
export const PREVIEW_FALLBACK_INSTRUMENT: InstrumentKindId = "pulse";
/** Lead-in so the first note isn't clipped by scheduling latency. */
const LEAD_IN_SECONDS = 0.08;
/** Time after the last note for a release tail before the preview's instances are removed. */
const TAIL_SECONDS = 1.2;

export interface PreviewSpec {
  tracks: RecipeTrack[];
  bars: number;
  scale: ProjectScale;
  bpm: number;
  beatsPerBar: number;
}

/** The throwaway project a preview plays: one synth track per part, plus its pattern. Pure. */
export function buildPreviewProject(spec: PreviewSpec): { project: Project; pattern: Pattern } {
  let project = createInitialProject("Guide preview", Math.max(1, spec.tracks.length), spec.beatsPerBar, spec.bpm);
  spec.tracks.forEach((t, i) => {
    const kind = t.instrument && t.instrument in INSTRUMENT_DEFS ? t.instrument : PREVIEW_FALLBACK_INSTRUMENT;
    project = setTrackInstrument(project, project.tracks[i].id, kind);
  });
  project = { ...project, scale: spec.scale };
  const notes: Pattern["notes"] = {};
  spec.tracks.forEach((rt, i) => {
    for (const n of resolveRecipeTrack(rt, project.tracks[i], spec.scale, spec.beatsPerBar, spec.bars)) notes[n.id] = n;
  });
  const pattern: Pattern = { id: "guide-preview", name: "Guide preview", bars: spec.bars, notes };
  return { project: { ...project, patterns: [pattern] }, pattern };
}

export class GuidePreview {
  private readonly host: InstrumentHost;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onEnd: (() => void) | null = null;

  constructor(private readonly runtime: AudioRuntime) {
    this.host = new InstrumentHost(runtime);
  }

  /** Plays the spec once, replacing whatever preview is sounding. `onEnd` fires when it finishes
   * on its own or is stopped/replaced. */
  play(spec: PreviewSpec, onEnd?: () => void): void {
    this.stop();
    const { project, pattern } = buildPreviewProject(spec);
    const buses = Object.fromEntries(project.tracks.map((t) => [t.id, MASTER_BUS]));
    this.host.sync(project, buses);
    const start = this.runtime.getCurrentTime() + LEAD_IN_SECONDS;
    for (const e of compileInstrumentNotes(pattern, project.tracks, spec.bpm, start, 0.5, undefined, spec.beatsPerBar, spec.scale)) {
      this.host.noteOn(e.trackId, e.params, e.voice);
    }
    this.onEnd = onEnd ?? null;
    const seconds = spec.bars * spec.beatsPerBar * secondsPerBeat(spec.bpm) + LEAD_IN_SECONDS + TAIL_SECONDS;
    this.timer = setTimeout(() => this.stop(), seconds * 1000);
  }

  /** Silences the preview and frees its instances. Safe to call when nothing is playing. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.host.stopAll();
    this.host.sync({ ...createInitialProject("", 1), tracks: [], patterns: [] }, {});
    const done = this.onEnd;
    this.onEnd = null;
    done?.();
  }
}
