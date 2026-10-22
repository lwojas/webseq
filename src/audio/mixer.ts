// Pushes a track's live mixer state to its bus, one control per signal path:
//   BusGain      the fader (volume, or 0 when muted) — before both outputs, so mute silences the
//                main output and the FX send alike;
//   BusPan       stereo position;
//   BusMainGain  solo's gate on the main output only (model/types.ts's mainGate);
//   BusSendAmount  the post-fader FX send level (send amount x solo's send gate).
// All are plain bus controls from webdsp's point of view; nothing is volume/mute/solo-specific
// on the engine side, only in how this file computes the numbers it sends. None of them wakes a
// dormant bus (see busSync.ts). The send's destination is routed in busSync.ts.
import { NodeParam, type AudioRuntime, type BusId } from "webdsp";
import type { Project, Track } from "../model/types";
import { effectivePan, faderGain, mainGate, sendLevel } from "../model/types";

export function applyTrackMix(runtime: AudioRuntime, busId: BusId, project: Project, track: Track): void {
  runtime.setNodeParameter(busId, NodeParam.BusGain, faderGain(track));
  runtime.setNodeParameter(busId, NodeParam.BusMainGain, mainGate(project, track));
  runtime.setNodeParameter(busId, NodeParam.BusSendAmount, sendLevel(project, track));
  runtime.setNodeParameter(busId, NodeParam.BusPan, effectivePan(track));
}
