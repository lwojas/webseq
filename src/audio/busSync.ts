// Pushes the project's FX chains and mixer state onto the engine's buses. This is the one place
// that decides which buses get DSP parameters at all.
//
// A track's bus is "configured" once its track has carried FX. Until then nothing but volume is
// sent to it. webdsp skips a bus that has never been fed and has no DSP parameter set (see
// webdsp's Bus::isDormant), so an unused track costs nothing per audio block. Sending a full FX
// chain to every bus would configure all of them and turn that skip off. Volume (BusGain) does
// not configure a bus, so it is sent to every track. Once configured, a bus stays configured, so
// removing the last FX still resets it to transparent. Configured buses are processed every
// block.
import { MASTER_BUS, type AudioRuntime } from "webdsp";
import type { Project, TrackId } from "../model/types";
import type { TrackBusMap } from "./buses";
import { applyFxChain } from "./applyFx";
import { applyTrackVolume } from "./mixer";

/** Tracks whose bus has been given DSP parameters. Only grows, for the life of one runtime. */
export type ConfiguredBuses = Set<TrackId>;

export function syncBuses(runtime: AudioRuntime, project: Project, buses: TrackBusMap, configured: ConfiguredBuses): void {
  applyFxChain(runtime, MASTER_BUS, project.master.fx);
  for (const track of project.tracks) {
    const busId = buses[track.id];
    if (busId === undefined) continue;
    if (track.fx.length > 0) configured.add(track.id);
    if (configured.has(track.id)) applyFxChain(runtime, busId, track.fx);
    applyTrackVolume(runtime, busId, project, track);
  }
}
