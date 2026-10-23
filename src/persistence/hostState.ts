// The project in a host's session (webdsp's getHostState(), e.g. a DAW plugin): the same record the local recovery
// write uses, plus the asset bytes, handed to the host as an opaque snapshot. See webdsp docs/host-state.md.
//
// When a host is present it is the source of truth, so the local IndexedDB recovery slot (shared by every instance of
// the plugin) is not used at all; in a browser none of this runs.
import type { HostStateBridge, HostStateSnapshot } from "webdsp";
import type { AssetId } from "../model/types";
import { parseRecoveryRecord, type RecoveryAssetData, type RecoveryRecord } from "./recovery";

export const HOST_STATE_APP = "webseq";
/** Version of the snapshot's `data` (a RecoveryRecord as JSON). Bump when a record can no longer be read by older code. */
export const HOST_STATE_FORMAT = 1;

/** The snapshot for a record: its JSON, and the bytes of exactly the assets the project uses, keyed by asset id. */
export function toHostSnapshot(record: RecoveryRecord, assetData: RecoveryAssetData): HostStateSnapshot {
  const blobs: Record<string, ArrayBuffer> = {};
  for (const asset of record.project.assets) {
    const bytes = assetData.get(asset.id);
    if (bytes) blobs[String(asset.id)] = bytes;
  }
  return { app: HOST_STATE_APP, format: HOST_STATE_FORMAT, data: JSON.stringify(record), blobs };
}

export function publishRecord(host: HostStateBridge, record: RecoveryRecord, assetData: RecoveryAssetData): void {
  host.publish(toHostSnapshot(record, assetData));
}

/** The record and asset bytes in a restored snapshot, or null when it is not ours, not a format we read, or malformed.
 * A null is "start fresh", never an error: unreadable state must not wedge startup. */
export function fromHostSnapshot(snapshot: HostStateSnapshot): { record: RecoveryRecord; assetData: RecoveryAssetData } | null {
  if (snapshot.app !== HOST_STATE_APP || snapshot.format !== HOST_STATE_FORMAT) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot.data);
  } catch {
    return null;
  }
  const record = parseRecoveryRecord(parsed);
  if (!record) return null;
  const assetData = new Map<AssetId, ArrayBuffer>();
  for (const asset of record.project.assets) {
    const bytes = snapshot.blobs[String(asset.id)];
    if (bytes) assetData.set(asset.id, bytes);
  }
  return { record, assetData };
}
