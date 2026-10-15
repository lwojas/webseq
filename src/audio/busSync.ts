// Pushes the project's mixer, FX chains, synth instruments and sample envelopes onto the engine.
// This is the one place that decides what the engine looks like for a given Project; App.tsx
// calls it on every project change, so each piece below is incremental and idempotent.
//
// Dormancy: webdsp skips a bus that has never been fed and has no effect configured (see
// webdsp's Bus::isDormant), so an unused track costs nothing per audio block. FX are created
// only for chains that contain FX (FxChainSync.sync is a no-op for an empty chain on an
// untouched bus), and volume/pan don't end dormancy, so they go to every track.
import { MASTER_BUS, type AudioRuntime } from "webdsp";
import type { Project } from "../model/types";
import { DEFAULT_ENVELOPE } from "../model/types";
import type { TrackBusMap } from "./buses";
import { fxChainsFor } from "./fxChain";
import { instrumentHostFor } from "./instruments";
import { applyTrackMix } from "./mixer";

// Last envelope pushed per asset, per runtime. Sample ids are never reused within a runtime,
// so an unseen asset is assumed to be at the engine default.
const pushedEnvelopes = new WeakMap<AudioRuntime, Map<number, string>>();

function syncSampleEnvelopes(runtime: AudioRuntime, project: Project): void {
  let pushed = pushedEnvelopes.get(runtime);
  if (!pushed) {
    pushed = new Map();
    pushedEnvelopes.set(runtime, pushed);
  }
  const defaultKey = JSON.stringify(DEFAULT_ENVELOPE);
  for (const asset of project.assets) {
    const envelope = asset.envelope ?? DEFAULT_ENVELOPE;
    const key = JSON.stringify(envelope);
    if ((pushed.get(asset.id) ?? defaultKey) === key) continue;
    pushed.set(asset.id, key);
    runtime.setSampleEnvelope(asset.id, envelope);
  }
}

export function syncBuses(runtime: AudioRuntime, project: Project, buses: TrackBusMap): void {
  const chains = fxChainsFor(runtime);
  chains.sync(MASTER_BUS, project.master.fx);
  for (const track of project.tracks) {
    const busId = buses[track.id];
    if (busId === undefined) continue;
    chains.sync(busId, track.fx);
    applyTrackMix(runtime, busId, project, track);
  }
  instrumentHostFor(runtime).sync(project, buses);
  syncSampleEnvelopes(runtime, project);
}
