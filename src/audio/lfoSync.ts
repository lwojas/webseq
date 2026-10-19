// Pushes a model LFO stack (TrackLfo[]) onto an engine owner's LFO slots. Shared by the synth
// host (instruments.ts) and the FX chain (fxChain.ts): both owners use webdsp's one LFO bank, so
// the translation is written once. Names (waveform, division, target) are resolved against the
// engine's own tables here, at the boundary: anything the engine does not know, or no longer
// offers as a modulation target, leaves that slot off. Unchanged slots are never resent.
import type { ModulationCapabilities } from "webdsp";
import type { TrackLfo } from "../model/types";

export interface EngineLfo {
  target: number;
  amount: number;
  waveform: number;
  sync: boolean;
  rateHz: number;
  division: number;
  phase: number;
}

/** `targets` maps a modulatable control name to its engine param id. `sent` is the owner's
 * per-slot cache ("" = slot empty) and is updated in place. */
export function syncLfoSlots(
  info: ModulationCapabilities,
  lfos: readonly TrackLfo[],
  targets: ReadonlyMap<string, number>,
  sent: string[],
  apply: (slot: number, lfo: EngineLfo) => void,
  clear: (slot: number) => void,
): void {
  for (let slot = 0; slot < info.maxLfos; slot++) {
    const lfo = lfos[slot];
    const waveform = lfo ? info.waveforms.indexOf(lfo.waveform) : -1;
    const division = lfo ? info.divisions.findIndex((d) => d.name === lfo.division) : -1;
    const target = lfo ? targets.get(lfo.target) : undefined;
    const valid = lfo && waveform >= 0 && target !== undefined && (!lfo.sync || division >= 0);
    const sig = valid ? JSON.stringify(lfo) : "";
    if (sig === (sent[slot] ?? "")) continue;
    sent[slot] = sig;
    if (valid) {
      apply(slot, {
        target: target!,
        amount: lfo.amount,
        waveform,
        sync: lfo.sync,
        rateHz: lfo.rateHz,
        division: Math.max(0, division),
        phase: lfo.phase,
      });
    } else {
      clear(slot);
    }
  }
}
