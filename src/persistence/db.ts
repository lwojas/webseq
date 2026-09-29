// Thin IndexedDB wrapper — the only place this app talks to IndexedDB directly. Chosen over
// localStorage because a project's asset audio is raw binary and can be large (localStorage
// is string-only and capped around 5MB); IndexedDB keeps the whole app local/offline-capable
// with no backend, per the project brief. Two object stores: "projects" (the serializable
// Project JSON, keyed by its id) and "assets" (raw source bytes per Asset, keyed by
// `${projectId}:${assetId}`) — see projectStore.ts for why asset bytes are kept separate
// from the project JSON rather than embedded in it.

const DB_NAME = "webseq";
// Bumped from 1 -> 2 to create the "assets" store (renamed from "samples") — onupgradeneeded
// only fires on a version bump, so a lower version would leave an existing local database
// without it.
const DB_VERSION = 2;
export const PROJECTS_STORE = "projects";
export const ASSETS_STORE = "assets";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ASSETS_STORE)) db.createObjectStore(ASSETS_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
