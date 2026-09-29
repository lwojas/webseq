// Maps each track to its own webdsp bus, so a track's FX chain (src/audio/applyFx.ts) and its
// triggered voices (src/audio/compile.ts) always agree on which bus that track owns. This
// mapping is pure runtime state, deliberately kept out of the serializable Project (see
// model/types.ts's Asset doc comment and README's persistence notes) — a BusId is a live
// AudioRuntime handle, meaningless across a reload, so it's never persisted alongside the
// project.
//
// IMPORTANT: webdsp's AudioRuntime.createBus() hands buses out from a one-way counter capped
// at MAX_TRACK_BUSES (32) — there is no releaseBus()/freeBus() call, ever. This mapping must
// therefore live for the entire lifetime of one AudioRuntime, not be thrown away and rebuilt
// per project: every project in this app has the same fixed, deterministic track ids
// (project.ts's createInitialTracks — "track-1".."track-16", no add/remove-track feature), so
// App.tsx intentionally keeps one TrackBusMap across New/Load rather than resetting it (a
// reset used to make ensureTrackBuses request a fresh set of 16 buses on every load, which
// exhausted the pool and crashed after just two loads).
import { MASTER_BUS, type AudioRuntime, type BusId } from "webdsp";
import type { FxTarget, TrackId } from "../model/types";

export type TrackBusMap = Record<TrackId, BusId>;

/** Ensures every id in `trackIds` has an assigned bus, creating new ones only for ids not
 * already in `existing` — idempotent, so it's safe to call again after a track is added, or
 * after a different project (with the same track ids) is loaded, without requesting new buses
 * for ids `existing` already covers. See this file's module doc comment for why that idempotency
 * is load-bearing, not just an optimization. */
export function ensureTrackBuses(runtime: AudioRuntime, trackIds: TrackId[], existing: TrackBusMap = {}): TrackBusMap {
  const buses: TrackBusMap = { ...existing };
  for (const id of trackIds) {
    if (!(id in buses)) buses[id] = runtime.createBus();
  }
  return buses;
}

export function busIdForTarget(buses: TrackBusMap, target: FxTarget): BusId | undefined {
  return target === "master" ? MASTER_BUS : buses[target];
}
