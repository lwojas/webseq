// Pushes the project's mixer, FX chains, synth instruments and sample envelopes onto the engine.
// This is the one place that decides what the engine looks like for a given Project; App.tsx
// calls it on every project change, so each piece below is incremental and idempotent.
//
// Dormancy: webdsp skips a bus that has never been fed and has no effect configured (see
// webdsp's Bus::isDormant), so an unused track costs nothing per audio block. FX are created
// only for chains that contain FX (FxChainSync.sync is a no-op for an empty chain on an
// untouched bus), and volume/pan don't end dormancy, so they go to every track.
import { MASTER_BUS, NodeParam, type AudioRuntime, type BusId } from "webdsp";
import { resolvedOutput, type Project } from "../model/types";
import { assetLengthFrames, cueRegions } from "../model/chop";
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

// Last cue set pushed per asset, per runtime, like the envelopes above. Fractions become frame
// regions here, only for assets that have (or had) cues. A re-imported/reloaded asset has a new
// id and so is pushed afresh.
const pushedRegions = new WeakMap<AudioRuntime, Map<number, string>>();

function syncSampleRegions(runtime: AudioRuntime, project: Project): void {
  let pushed = pushedRegions.get(runtime);
  if (!pushed) {
    pushed = new Map();
    pushedRegions.set(runtime, pushed);
  }
  for (const asset of project.assets) {
    const key = JSON.stringify([asset.chopStart ?? 0, asset.cues ?? []]);
    if ((pushed.get(asset.id) ?? "[0,[]]") === key) continue;
    pushed.set(asset.id, key);
    const cues = asset.cues ?? [];
    runtime.setSampleRegions(asset.id, cues.length > 0 ? cueRegions(cues, assetLengthFrames(asset), asset.chopStart ?? 0) : []);
  }
}

// Last output route pushed per track bus, per runtime (bus -> destination bus, 0 = master). A
// bus the engine has never been told about is at its default, master.
const pushedRoutes = new WeakMap<AudioRuntime, Map<BusId, BusId>>();

// Pushes each track's output route as NodeParam.BusOutput. The engine refuses a route that would
// close a loop *given the routes it currently has*, so when several routes change at once (a
// project load, an undo) the changed ones are first parked on master and then set to their new
// destinations — safe for any acyclic target graph, whatever order the changes arrive in.
function syncRoutes(runtime: AudioRuntime, project: Project, buses: TrackBusMap): void {
  let pushed = pushedRoutes.get(runtime);
  if (!pushed) {
    pushed = new Map();
    pushedRoutes.set(runtime, pushed);
  }
  const changed: Array<[BusId, BusId]> = [];
  for (const track of project.tracks) {
    const busId = buses[track.id];
    if (busId === undefined) continue;
    const out = resolvedOutput(project, track);
    const dest = out === "master" ? MASTER_BUS : (buses[out] ?? MASTER_BUS);
    if ((pushed.get(busId) ?? MASTER_BUS) !== dest) changed.push([busId, dest]);
  }
  for (const [busId] of changed) {
    if ((pushed.get(busId) ?? MASTER_BUS) !== MASTER_BUS) runtime.setNodeParameter(busId, NodeParam.BusOutput, MASTER_BUS);
  }
  for (const [busId, dest] of changed) {
    if (dest !== MASTER_BUS) runtime.setNodeParameter(busId, NodeParam.BusOutput, dest);
    pushed.set(busId, dest);
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
  syncRoutes(runtime, project, buses);
  instrumentHostFor(runtime).sync(project, buses);
  syncSampleEnvelopes(runtime, project);
  syncSampleRegions(runtime, project);
}
