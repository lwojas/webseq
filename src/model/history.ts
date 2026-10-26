// Undo/redo for editing actions, as a thin wrapper around projectReducer — no second source of
// truth: `present` is the project, and the history only remembers how to reverse each edit.
//
// What an entry stores: a field-level patch of just the patterns/tracks the action changed
// (the `before` and `after` values of the fields that differ). Project objects are immutable and
// share structure, so a patch is a few references — no project clones. Undo/redo apply the patch
// onto the *current* project, so anything outside it (mixer moves, BPM, queue, renames, assets…)
// is left exactly as it is. Runtime state (transport, audio, selection) lives outside the
// project and is never involved.
import { projectReducer, type Action } from "./reducer";
import type { Pattern, Project, Track } from "./types";

/** Undo steps kept. An entry is a handful of references to the notes records/tracks it replaced,
 * so 100 steps stays small even for large patterns. */
export const MAX_HISTORY = 100;

export type HistoryAction = Action | { type: "UNDO" } | { type: "REDO" };

type Fields = Record<string, unknown>;
interface Patch {
  kind: "pattern" | "track";
  id: string;
  before: Fields;
  after: Fields;
}
interface Entry {
  /** Set for continuous edits (drags, nudges) so repeats of the same edit fold into one step. */
  coalesce: string | null;
  patches: Patch[];
}

export interface History {
  present: Project;
  past: Entry[];
  future: Entry[];
  /** The coalesce key of the latest entry while it may still absorb more of the same edit. */
  openKey: string | null;
}

export function createHistory(present: Project): History {
  return { present, past: [], future: [], openKey: null };
}

/** The actions that count as user edits of the sequence or of the track data pasted around it.
 * Everything else (mixer, FX knobs, transport-adjacent state, assets, renames, queue, load)
 * passes straight through and is not undoable. */
const UNDOABLE = new Set<Action["type"]>([
  "ADD_NOTE", "REMOVE_NOTE", "CLEAR_TRACK_NOTES", "PASTE_NOTES", "MOVE_NOTE", "RESIZE_NOTE",
  "SET_NOTE_PITCH", "SET_NOTE_MODE", "SET_NOTE_CHORD", "SET_NOTE_VELOCITY", "SET_NOTE_RATCHET", "SET_NOTE_TIE", "SET_TRACK_NOTES_TIE", "SET_NOTE_LFO", "SET_TRACK_NOTES_LFO",
  "EXTEND_TRACK", "DUPLICATE_SEQUENCE", "DUPLICATE_BAR", "SET_PATTERN_BARS",
  "PASTE_TRACK", "PASTE_TRACK_CONFIG", "PASTE_INSTRUMENT", "PASTE_FX", "PASTE_MODULATION", "PASTE_BANK",
]);

/** Repeats of the same continuous edit on the same target fold into one undo step. */
function coalesceKey(action: Action): string | null {
  switch (action.type) {
    case "MOVE_NOTE": case "RESIZE_NOTE": case "SET_NOTE_PITCH": case "SET_NOTE_MODE":
    case "SET_NOTE_CHORD": case "SET_NOTE_VELOCITY": case "SET_NOTE_RATCHET": case "SET_NOTE_TIE": case "SET_NOTE_LFO":
      return `${action.type}:${action.patternId}:${action.noteId}`;
    case "SET_TRACK_NOTES_LFO": case "SET_TRACK_NOTES_TIE":
      return `${action.type}:${action.patternId}:${action.trackId}`;
    default:
      return null;
  }
}

function diffObject(a: object, b: object): { before: Fields; after: Fields } | null {
  const x = a as Fields;
  const y = b as Fields;
  const before: Fields = {};
  const after: Fields = {};
  let changed = false;
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (x[key] !== y[key]) {
      before[key] = x[key];
      after[key] = y[key];
      changed = true;
    }
  }
  return changed ? { before, after } : null;
}

function diffList<T extends { id: string }>(kind: Patch["kind"], prev: T[], next: T[]): Patch[] {
  if (prev === next) return [];
  const old = new Map(prev.map((item) => [item.id, item]));
  const patches: Patch[] = [];
  for (const item of next) {
    const was = old.get(item.id);
    const d = was && was !== item ? diffObject(was, item) : null;
    if (d) patches.push({ kind, id: item.id, ...d });
  }
  return patches;
}

function diffProject(prev: Project, next: Project): Patch[] {
  return [...diffList<Pattern>("pattern", prev.patterns, next.patterns), ...diffList<Track>("track", prev.tracks, next.tracks)];
}

function applyFields<T extends { id: string }>(items: T[], id: string, fields: Fields): T[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    const copy = { ...item } as Fields;
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) delete copy[key];
      else copy[key] = value;
    }
    return copy as T;
  });
}

function applyEntry(project: Project, entry: Entry, side: "before" | "after"): Project {
  let { patterns, tracks } = project;
  for (const patch of entry.patches) {
    if (patch.kind === "pattern") patterns = applyFields(patterns, patch.id, patch[side]);
    else tracks = applyFields(tracks, patch.id, patch[side]);
  }
  return { ...project, patterns, tracks };
}

/** Folds `next` into `prev` (same target, consecutive): earliest `before`, latest `after`. */
function mergePatches(prev: Patch[], next: Patch[]): Patch[] {
  const merged = prev.map((p) => ({ ...p }));
  for (const patch of next) {
    const hit = merged.find((p) => p.kind === patch.kind && p.id === patch.id);
    if (hit) {
      hit.before = { ...patch.before, ...hit.before };
      hit.after = { ...hit.after, ...patch.after };
    } else {
      merged.push(patch);
    }
  }
  return merged;
}

export function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case "UNDO": {
      const entry = state.past[state.past.length - 1];
      if (!entry) return state;
      return { present: applyEntry(state.present, entry, "before"), past: state.past.slice(0, -1), future: [...state.future, entry], openKey: null };
    }
    case "REDO": {
      const entry = state.future[state.future.length - 1];
      if (!entry) return state;
      return { present: applyEntry(state.present, entry, "after"), past: [...state.past, entry], future: state.future.slice(0, -1), openKey: null };
    }
    case "LOAD_PROJECT":
      // New/Load/recovery start a fresh document: nothing from the old one can be undone into it.
      return createHistory(action.project);
  }
  const present = projectReducer(state.present, action);
  if (present === state.present) return state;
  if (!UNDOABLE.has(action.type)) return { ...state, present };
  const patches = diffProject(state.present, present);
  if (patches.length === 0) return { ...state, present };
  const key = coalesceKey(action);
  const last = state.past[state.past.length - 1];
  if (key && last && state.openKey === key) {
    const entry: Entry = { coalesce: key, patches: mergePatches(last.patches, patches) };
    return { present, past: [...state.past.slice(0, -1), entry], future: [], openKey: key };
  }
  const past = [...state.past, { coalesce: key, patches }];
  return { present, past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past, future: [], openKey: key };
}
