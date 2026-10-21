// IndexedDB glue for the recovery slot (see recovery.ts). Like webtracker, one fixed slot —
// webseq recovers a single session, not a history. Asset bytes reuse the existing assets store
// under a reserved project id, so nothing is duplicated into the record and an explicit Save/
// Load/Delete of a real project can never touch them (keys are `${projectId}:${assetId}`).
import { ASSETS_STORE, RECOVERY_STORE, idbRequest, openDb } from "./db";
import { parseRecoveryRecord, type RecoveryAssetData, type RecoveryRecord } from "./recovery";
import type { AssetId } from "../model/types";

const RECOVERY_KEY = "latest";
const RECOVERY_ASSET_PREFIX = "__recovery__:";
const assetKey = (id: AssetId) => `${RECOVERY_ASSET_PREFIX}${id}`;

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Bytes already persisted for the current recovery slot, by id. Compared by buffer identity so
 * an id the runtime hands out again for different audio (after a Load) is rewritten, and each
 * asset's bytes are written once, not on every debounced edit. */
const written = new Map<AssetId, ArrayBuffer>();

/** Forget what's been written (the slot was cleared, or a different project took over). */
export function resetRecoveryAssetCache(): void {
  written.clear();
}

export async function putRecovery(record: RecoveryRecord, assetData: RecoveryAssetData): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([RECOVERY_STORE, ASSETS_STORE], "readwrite");
  tx.objectStore(RECOVERY_STORE).put({ ...record, id: RECOVERY_KEY });
  const assets = tx.objectStore(ASSETS_STORE);
  const wanted = new Set<string>();
  const toMark: [AssetId, ArrayBuffer][] = [];
  for (const asset of record.project.assets) {
    const data = assetData.get(asset.id);
    if (!data) continue;
    wanted.add(assetKey(asset.id));
    if (written.get(asset.id) === data) continue;
    assets.put({ key: assetKey(asset.id), projectId: "__recovery__", assetId: asset.id, name: asset.name, data });
    toMark.push([asset.id, data]);
  }
  const keys = await idbRequest<IDBValidKey[]>(assets.getAllKeys());
  for (const key of keys) {
    if (typeof key === "string" && key.startsWith(RECOVERY_ASSET_PREFIX) && !wanted.has(key)) assets.delete(key);
  }
  await txDone(tx);
  for (const id of [...written.keys()]) if (!wanted.has(assetKey(id))) written.delete(id);
  for (const [id, data] of toMark) written.set(id, data);
}

/** The stored record, or null when there is none *or* it's malformed (a malformed one is
 * cleared so it can't block or re-prompt on later startups). Never throws. */
export async function getRecovery(): Promise<RecoveryRecord | null> {
  try {
    const db = await openDb();
    const raw = await idbRequest<unknown>(db.transaction(RECOVERY_STORE, "readonly").objectStore(RECOVERY_STORE).get(RECOVERY_KEY));
    if (raw === undefined) return null;
    const record = parseRecoveryRecord(raw);
    if (!record) await clearRecovery();
    return record;
  } catch {
    return null;
  }
}

export async function getRecoveryAssets(record: RecoveryRecord): Promise<RecoveryAssetData> {
  const db = await openDb();
  const store = db.transaction(ASSETS_STORE, "readonly").objectStore(ASSETS_STORE);
  const out: RecoveryAssetData = new Map();
  for (const asset of record.project.assets) {
    const stored = await idbRequest<{ data?: ArrayBuffer } | undefined>(store.get(assetKey(asset.id)));
    if (stored?.data instanceof ArrayBuffer) out.set(asset.id, stored.data);
  }
  return out;
}

/** Drops the slot and its asset bytes. Best-effort (never rejects). */
export async function clearRecovery(): Promise<void> {
  written.clear();
  try {
    const db = await openDb();
    const tx = db.transaction([RECOVERY_STORE, ASSETS_STORE], "readwrite");
    tx.objectStore(RECOVERY_STORE).delete(RECOVERY_KEY);
    const assets = tx.objectStore(ASSETS_STORE);
    const keys = await idbRequest<IDBValidKey[]>(assets.getAllKeys());
    for (const key of keys) if (typeof key === "string" && key.startsWith(RECOVERY_ASSET_PREFIX)) assets.delete(key);
    await txDone(tx);
  } catch {
    // A failed clear just means the same prompt may reappear next startup.
  }
}
