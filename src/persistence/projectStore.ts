// Project save/load. A Project (model/types.ts) is already plain, deterministic, JSON-
// serializable data — no functions, no AudioRuntime/AudioWorklet/WASM objects — so it's saved
// as-is. Asset audio is kept in a *separate* IndexedDB store rather than embedded as base64
// inside the project JSON: assets are commonly reused across edits/saves (that's the whole
// point of the Asset Bin — the same asset can back multiple tracks), keeping them separate
// avoids repeatedly duplicating potentially large binary payloads inside every project
// snapshot, and it mirrors the runtime's own separation of "sample bytes" from "everything
// that references a sample by id" (see model/types.ts's Asset). An imported asset's bytes are
// whatever file the user picked (decoded on load via runtime.loadSample()); a resampled
// asset's bytes are a WAV encoding of its captured PCM (see audio/wav.ts) — both flow through
// exactly the same store and reload path below.
//
// One thing this file deliberately does NOT do: reuse a loaded project's AssetId values
// as-is. AssetId is the same numeric space as webdsp's SampleId (types.ts), and webdsp assigns
// SampleId sequentially per AudioRuntime instance (see webdsp's AudioRuntime.loadSample), so a
// fresh runtime almost never reproduces the same ids a previous session had. Loading a
// project therefore re-registers each asset's audio with the current runtime and remaps every
// reference to the id it's actually given this time — see remapAssetIds in model/project.ts,
// used by App.tsx's load flow.
import { PROJECTS_STORE, ASSETS_STORE, idbRequest, openDb } from "./db";
import type { AssetId, Project } from "../model/types";

interface StoredAsset {
  key: string;
  projectId: string;
  assetId: AssetId;
  name: string;
  data: ArrayBuffer;
}

function assetKey(projectId: string, assetId: AssetId): string {
  return `${projectId}:${assetId}`;
}

export async function saveProject(project: Project, assetData: Map<AssetId, ArrayBuffer>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([PROJECTS_STORE, ASSETS_STORE], "readwrite");
  tx.objectStore(PROJECTS_STORE).put(project);
  const assetsStore = tx.objectStore(ASSETS_STORE);
  for (const asset of project.assets) {
    const data = assetData.get(asset.id);
    if (!data) continue; // shouldn't happen for an asset the project references, but don't crash a save over it
    const stored: StoredAsset = { key: assetKey(project.id, asset.id), projectId: project.id, assetId: asset.id, name: asset.name, data };
    assetsStore.put(stored);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface LoadedProject {
  project: Project;
  /** Raw source bytes for every asset the project references, keyed by the AssetId the
   * project was *saved* with — App.tsx re-registers these with the live runtime and remaps
   * ids (see this file's module doc comment) before putting the project into app state. */
  assetData: Map<AssetId, ArrayBuffer>;
}

export async function loadProject(projectId: string): Promise<LoadedProject | null> {
  const db = await openDb();
  const tx = db.transaction([PROJECTS_STORE, ASSETS_STORE], "readonly");
  const project = await idbRequest<Project | undefined>(tx.objectStore(PROJECTS_STORE).get(projectId));
  if (!project) return null;
  const assetData = new Map<AssetId, ArrayBuffer>();
  for (const asset of project.assets) {
    const stored = await idbRequest<StoredAsset | undefined>(tx.objectStore(ASSETS_STORE).get(assetKey(projectId, asset.id)));
    if (stored) assetData.set(asset.id, stored.data);
  }
  return { project, assetData };
}

export async function listProjects(): Promise<{ id: string; name: string }[]> {
  const db = await openDb();
  const tx = db.transaction(PROJECTS_STORE, "readonly");
  const all = await idbRequest<Project[]>(tx.objectStore(PROJECTS_STORE).getAll());
  return all.map((p) => ({ id: p.id, name: p.name }));
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([PROJECTS_STORE, ASSETS_STORE], "readwrite");
  tx.objectStore(PROJECTS_STORE).delete(projectId);
  const assetsStore = tx.objectStore(ASSETS_STORE);
  const keys = await idbRequest<IDBValidKey[]>(assetsStore.getAllKeys());
  for (const key of keys) {
    if (typeof key === "string" && key.startsWith(`${projectId}:`)) assetsStore.delete(key);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
