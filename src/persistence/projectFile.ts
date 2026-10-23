// The project as a file you can move between browser and plugin (and keep): an explicit, versioned envelope around the
// Project and the bytes of the assets it uses, in one JSON document -- modelled on webtracker's projectFile.js. Pure and
// DOM-free so it is unit-testable; the file picker / download / host dialog glue is projectIO.ts.
//
// A Project is already plain JSON (see projectStore.ts); asset audio is embedded as base64 (the original file bytes, as
// imported, or the WAV of a resample) so the file is self-contained. Asset ids in the file are the ids the project was
// saved with; loading re-registers each asset with the engine and remaps ids (installProject / remapAssetIds), exactly
// as loading a saved project does.
import type { AssetId, Project } from "../model/types";
import { isProjectLike } from "./recovery";

export const PROJECT_FILE_KIND = "webseq-project";
/** Version of this envelope. Bump when an older build could no longer read a file; new Project fields are additive and need no bump. */
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXTENSION = "webseq.json";

export interface ProjectFile {
  kind: typeof PROJECT_FILE_KIND;
  formatVersion: number;
  savedAt: string;
  project: Project;
  /** Original bytes of the assets the project uses, base64, keyed by the asset id as a string. */
  assets: Record<string, string>;
}

export type ProjectFileResult = { project: Project; assetData: Map<AssetId, ArrayBuffer> };

const CHUNK = 0x8000;

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  return btoa(binary);
}

function base64ToBytes(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** The file's JSON text for `project`, embedding the bytes of exactly the assets it uses. */
export function serializeProjectFile(project: Project, assetData: ReadonlyMap<AssetId, ArrayBuffer>, now: Date = new Date()): string {
  const assets: Record<string, string> = {};
  for (const asset of project.assets) {
    const bytes = assetData.get(asset.id);
    if (bytes) assets[String(asset.id)] = bytesToBase64(bytes);
  }
  const file: ProjectFile = { kind: PROJECT_FILE_KIND, formatVersion: PROJECT_FILE_VERSION, savedAt: now.toISOString(), project, assets };
  return JSON.stringify(file);
}

/** Reads a project file. Throws an Error with a message fit to show the user for anything that is not one we can open;
 * an asset whose bytes are missing or unreadable is skipped (the track keeps its reference and plays nothing),
 * not a failure of the whole file. */
export function parseProjectFile(text: string): ProjectFileResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This is not a webseq project file (it is not valid JSON).");
  }
  if (typeof raw !== "object" || raw === null || (raw as { kind?: unknown }).kind !== PROJECT_FILE_KIND) {
    throw new Error("This is not a webseq project file.");
  }
  const file = raw as Partial<ProjectFile>;
  if (typeof file.formatVersion !== "number") throw new Error("This project file has no version.");
  if (file.formatVersion > PROJECT_FILE_VERSION) {
    throw new Error(`This project file is from a newer webseq (format ${file.formatVersion}; this one reads up to ${PROJECT_FILE_VERSION}). Update webseq to open it.`);
  }
  if (!isProjectLike(file.project)) throw new Error("This project file is damaged (the project inside is incomplete).");

  const assetData = new Map<AssetId, ArrayBuffer>();
  for (const asset of file.project.assets) {
    const encoded = file.assets?.[String(asset.id)];
    if (typeof encoded !== "string") continue;
    try {
      assetData.set(asset.id, base64ToBytes(encoded));
    } catch {
      // unreadable bytes: this one asset is skipped
    }
  }
  return { project: file.project, assetData };
}

/** A file name for `project`: its name made safe, plus the extension. */
export function projectFileName(project: Pick<Project, "name">): string {
  const base = project.name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").replace(/^\.+/, "").slice(0, 80) || "project";
  return `${base}.${PROJECT_FILE_EXTENSION}`;
}
