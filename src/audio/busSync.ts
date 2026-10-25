// Pushes the project's mixer, FX chains, synth instruments and sample envelopes/gains onto the engine.
// This is the one place that decides what the engine looks like for a given Project; App.tsx
// calls it on every project change, so each piece below is incremental and idempotent.
//
// Dormancy: webdsp skips a bus that has never been fed and has no effect configured (see
// webdsp's Bus::isDormant), so an unused track costs nothing per audio block. FX are created
// only for chains that contain FX (FxChainSync.sync is a no-op for an empty chain on an
// untouched bus), and volume/pan don't end dormancy, so they go to every track.
import { MASTER_BUS, NodeParam, SampleParam, type AudioRuntime, type BusId } from "webdsp";
import { resolvedOutput, resolvedSend, type Project } from "../model/types";
import { assetLengthFrames, cueRegions } from "../model/chop";
import { DEFAULT_ENVELOPE, DEFAULT_SOURCE_GAIN_DB, dbToLinear, effectiveAssetGain } from "../model/types";
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

// Last source gain (dB) pushed per asset, per runtime, like the envelopes above. The engine's
// per-sample gain (SampleParam.Gain) is linear and applied to the sample before it reaches its
// bus, i.e. before the track's FX chain and fader; an unseen asset is at the engine default (0 dB).
const pushedGains = new WeakMap<AudioRuntime, Map<number, number>>();

function syncSampleGains(runtime: AudioRuntime, project: Project): void {
  let pushed = pushedGains.get(runtime);
  if (!pushed) {
    pushed = new Map();
    pushedGains.set(runtime, pushed);
  }
  for (const asset of project.assets) {
    const db = effectiveAssetGain(asset);
    if ((pushed.get(asset.id) ?? DEFAULT_SOURCE_GAIN_DB) === db) continue;
    pushed.set(asset.id, db);
    runtime.setSampleParameter(asset.id, SampleParam.Gain, dbToLinear(db));
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

// Last output route and send destination pushed per track bus, per runtime (bus -> destination
// bus; 0 = master for outputs, 0 = no send for sends). A bus the engine has never been told about
// is at its default.
const pushedRoutes = new WeakMap<AudioRuntime, Map<BusId, [BusId, BusId]>>();

// Pushes each track's output route (NodeParam.BusOutput) and FX send destination
// (NodeParam.BusSendTarget). The engine refuses an edge that would close a loop *given the edges
// it currently has*, so when several change at once (a project load, an undo) the changed buses'
// edges are first parked (output on master, send cleared) and then set to their new destinations
// — safe for any acyclic target graph, whatever order the changes arrive in. The send level
// itself (BusSendAmount) is a plain per-bus value pushed by applyTrackMix.
function syncRoutes(runtime: AudioRuntime, project: Project, buses: TrackBusMap): void {
  let pushed = pushedRoutes.get(runtime);
  if (!pushed) {
    pushed = new Map();
    pushedRoutes.set(runtime, pushed);
  }
  const changed: Array<[BusId, BusId, BusId]> = [];
  for (const track of project.tracks) {
    const busId = buses[track.id];
    if (busId === undefined) continue;
    const out = resolvedOutput(project, track);
    const dest = out === "master" ? MASTER_BUS : (buses[out] ?? MASTER_BUS);
    const send = resolvedSend(project, track);
    const sendDest = send ? (buses[send.to] ?? 0) : 0;
    const [oldDest, oldSend] = pushed.get(busId) ?? [MASTER_BUS, 0];
    if (oldDest !== dest || oldSend !== sendDest) changed.push([busId, dest, sendDest]);
  }
  for (const [busId] of changed) {
    const [oldDest, oldSend] = pushed.get(busId) ?? [MASTER_BUS, 0];
    if (oldDest !== MASTER_BUS) runtime.setNodeParameter(busId, NodeParam.BusOutput, MASTER_BUS);
    if (oldSend !== 0) runtime.setNodeParameter(busId, NodeParam.BusSendTarget, 0);
  }
  for (const [busId, dest, sendDest] of changed) {
    if (dest !== MASTER_BUS) runtime.setNodeParameter(busId, NodeParam.BusOutput, dest);
    if (sendDest !== 0) runtime.setNodeParameter(busId, NodeParam.BusSendTarget, sendDest);
    pushed.set(busId, [dest, sendDest]);
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
  syncSampleGains(runtime, project);
  syncSampleRegions(runtime, project);
}
