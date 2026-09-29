// Pushes a track's live mixer state (volume/mute/solo, already resolved to one gain number by
// model/types.ts's effectiveTrackGain) to its bus as webdsp's NodeParam.BusGain — the exact
// same per-bus real-time parameter FX params already use (see applyFx.ts). BusGain is a plain
// bus-output multiplier from webdsp's point of view; nothing here is volume/mute/solo-specific
// on the engine side, only in how this file computes the number it sends.
import { NodeParam, type AudioRuntime, type BusId } from "webdsp";
import type { Project, Track } from "../model/types";
import { effectiveTrackGain } from "../model/types";

export function applyTrackVolume(runtime: AudioRuntime, busId: BusId, project: Project, track: Track): void {
  runtime.setNodeParameter(busId, NodeParam.BusGain, effectiveTrackGain(project, track));
}
