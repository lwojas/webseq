// Debounced local-recovery writer + record validation — adapted from webtracker's
// persistence/recovery.js (the reference implementation). Same split as there: this file is
// plain, DOM-free logic (what gets written, when, and whether a stored record is usable) so
// test/recovery.test.ts can drive it with fake timers and an injected writer, while the
// IndexedDB glue lives in recoveryStore.ts.
//
// Unlike webtracker, no serializer is needed: a Project is already plain JSON (see
// projectStore.ts), so the record holds it as-is. Asset *bytes* are not in the record — they
// live in the assets store under a reserved recovery project id (recoveryStore.ts).
import type { AssetId, FxTarget, Project } from "../model/types";
import type { GridResolution } from "../model/notes";

const DEBOUNCE_MS = 1500;

/** The editor state worth restoring beyond the Project itself: where the user was looking.
 * Deliberately excludes runtime state (transport, auditions, clipboards, selected note). */
export interface RecoveryUi {
  selectedPatternId: string;
  selectedTarget: FxTarget;
  activeBank: number;
  gridResolution: GridResolution;
}

export interface RecoverySnapshot {
  project: Project;
  ui: RecoveryUi;
}

export interface RecoveryRecord extends RecoverySnapshot {
  projectId: string;
  projectName: string;
  /** Epoch ms. */
  savedAt: number;
}

export interface RecoveryScheduler {
  schedule(snapshot: RecoverySnapshot): void;
  /** Drops a pending write without firing it. Called before the open project is replaced
   * (New / Load / Restore) so a write for the previous project can't land after the swap. */
  cancel(): void;
}

export function createRecoveryScheduler({
  write,
  debounceMs = DEBOUNCE_MS,
  getNow = () => Date.now(),
}: {
  write: (record: RecoveryRecord) => Promise<void>;
  debounceMs?: number;
  getNow?: () => number;
}): RecoveryScheduler {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule({ project, ui }) {
      if (timerId !== null) clearTimeout(timerId);
      timerId = setTimeout(() => {
        timerId = null;
        write({ projectId: project.id, projectName: project.name, savedAt: getNow(), project, ui }).catch(() => {
          // Best-effort, same as webtracker: a failed recovery write only costs the *next*
          // crash recovery, never this session's correctness.
        });
      }, debounceMs);
    },
    cancel() {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Structural check on whatever came out of IndexedDB. Returns null for anything malformed or
 * from an incompatible build, so startup treats it as "no recovery" and clears it rather than
 * crashing on it. Intentionally shallow: it guards the fields restore dereferences directly. */
export function parseRecoveryRecord(raw: unknown): RecoveryRecord | null {
  if (!isObject(raw) || !isObject(raw.project) || !isObject(raw.ui)) return null;
  const { project, ui } = raw;
  if (typeof raw.projectId !== "string" || typeof raw.savedAt !== "number" || !Number.isFinite(raw.savedAt)) return null;
  if (typeof project.id !== "string" || typeof project.name !== "string") return null;
  if (!Array.isArray(project.tracks) || !Array.isArray(project.patterns) || project.patterns.length === 0) return null;
  if (!Array.isArray(project.assets) || !Array.isArray(project.patternChain)) return null;
  if (!project.assets.every((a) => isObject(a) && typeof a.id === "number")) return null;
  if (typeof ui.selectedPatternId !== "string" || typeof ui.selectedTarget !== "string") return null;
  if (typeof ui.activeBank !== "number" || typeof ui.gridResolution !== "number") return null;
  return raw as unknown as RecoveryRecord;
}

/** Formats a record's savedAt as "moments ago" / "N minutes ago" — one line of precision for the
 * restore prompt (same as webtracker's timeAgo). */
export function timeAgo(savedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 60) return "moments ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

export type RecoveryAssetData = Map<AssetId, ArrayBuffer>;
