// Pushes a track's live mixer state to its bus: volume/mute/solo (already resolved to one gain
// number by model/types.ts's effectiveTrackGain) as NodeParam.BusGain, and stereo position as
// NodeParam.BusPan. Both are plain bus-output controls from webdsp's point of view; nothing
// here is volume/mute/solo-specific on the engine side, only in how this file computes the
// numbers it sends. Neither wakes a dormant bus (see busSync.ts).
import { NodeParam, type AudioRuntime, type BusId } from "webdsp";
import type { Project, Track } from "../model/types";
import { effectivePan, effectiveTrackGain } from "../model/types";

export function applyTrackMix(runtime: AudioRuntime, busId: BusId, project: Project, track: Track): void {
  runtime.setNodeParameter(busId, NodeParam.BusGain, effectiveTrackGain(project, track));
  runtime.setNodeParameter(busId, NodeParam.BusPan, effectivePan(track));
}
