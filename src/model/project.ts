// Pure state-transition functions over Project. No React, no webdsp — every function here
// takes a project and returns a new project, so it's usable from a reducer, a test, or
// anything else without modification. Note-editing operations (notes.ts) are wrapped here so
// callers never need to manually locate-and-replace a pattern in project.patterns.

import type { Asset, AssetId, ChainEntry, ChainEntryId, NoteId, Pattern, PatternId, PlaybackMode, Project, Track, TrackId, VoiceMode } from "./types";
import { DEFAULT_PLAYBACK_MODE, DEFAULT_VOICE_MODE } from "./types";
import * as notes from "./notes";

export const MIN_BPM = 40;
export const MAX_BPM = 240;
export const DEFAULT_BPM = 120;
/** Pads per bank and number of banks (ECS-84). Banks are a view over the flat `tracks` list, not
 * stored state: bank N holds tracks [N * BANK_SIZE, (N + 1) * BANK_SIZE). */
export const BANK_SIZE = 16;
export const BANK_COUNT = 4;
export const DEFAULT_TRACK_COUNT = BANK_SIZE * BANK_COUNT;
export const DEFAULT_BEATS_PER_BAR = 16;

// 0.5 = straight (no-op), 0.75 = strong swing — see types.ts's Project.swing doc comment.
export const MIN_SWING = 0.5;
export const MAX_SWING = 0.75;
export const DEFAULT_SWING = 0.5;

// Linear gain multiplier (not dB) — mirrors webdsp's own TriggerParams.gain convention.
// Headroom above 1.0 is allowed (same as a normal DAW fader going "past unity"); 0 is silence.
export const MIN_TRACK_VOLUME = 0;
export const MAX_TRACK_VOLUME = 1.5;
export const DEFAULT_TRACK_VOLUME = 1;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createInitialTracks(trackCount = DEFAULT_TRACK_COUNT): Track[] {
  return Array.from({ length: trackCount }, (_, i) => ({
    id: `track-${i + 1}`,
    assetId: null,
    name: `Track ${String(i + 1).padStart(2, "0")}`,
    fx: [],
    automation: [],
    volume: DEFAULT_TRACK_VOLUME,
    muted: false,
    soloed: false,
    playbackMode: DEFAULT_PLAYBACK_MODE,
    voiceMode: DEFAULT_VOICE_MODE,
  }));
}

/** Adds any default tracks a project is missing. A project saved before banks existed has only
 * track-1..track-16. Existing tracks are kept exactly as they are. Track ids are fixed (see
 * createInitialTracks), so the appended ids are the ones the rest of the app expects. */
export function withMissingTracks(project: Project): Project {
  const present = new Set(project.tracks.map((t) => t.id));
  const missing = createInitialTracks(DEFAULT_TRACK_COUNT).filter((t) => !present.has(t.id));
  if (missing.length === 0) return project;
  return { ...project, tracks: [...project.tracks, ...missing] };
}

/** Bank (0-based) that the track at `index` in `project.tracks` belongs to. */
export function bankOfTrackIndex(index: number): number {
  return Math.floor(index / BANK_SIZE);
}

export function tracksInBank(project: Project, bank: number): Track[] {
  return project.tracks.slice(bank * BANK_SIZE, (bank + 1) * BANK_SIZE);
}

/** What the bank tabs show for one bank: how many of its tracks are looping right now, and
 * whether the selected pattern has any notes on one of its tracks. */
export interface BankSummary {
  loopCount: number;
  hasNotes: boolean;
}

export function summarizeBanks(project: Project, pattern: Pattern, loopingTrackIds: TrackId[]): BankSummary[] {
  const summaries: BankSummary[] = Array.from({ length: BANK_COUNT }, () => ({ loopCount: 0, hasNotes: false }));
  project.tracks.forEach((track, index) => {
    const summary = summaries[bankOfTrackIndex(index)];
    if (!summary) return;
    if (loopingTrackIds.includes(track.id)) summary.loopCount++;
  });
  const bankOfTrack = new Map(project.tracks.map((t, i) => [t.id, bankOfTrackIndex(i)] as const));
  for (const note of Object.values(pattern.notes)) {
    const bank = bankOfTrack.get(note.trackId);
    if (bank !== undefined && summaries[bank]) summaries[bank].hasNotes = true;
  }
  return summaries;
}

/** Rough engine memory for one asset's decoded audio: float32 per channel per frame. The engine
 * stores decoded PCM in this format (webdsp's SampleStore), so this is the number that counts
 * against the sample budget. */
export function estimateDecodedBytes(asset: Pick<Asset, "duration" | "sampleRate" | "channels">): number {
  return Math.round(asset.duration * asset.sampleRate * asset.channels * 4);
}

const MB = 1024 * 1024;
/** Soft ceiling on decoded sample memory (ECS-84). Above it the Assets panel warns; nothing is
 * blocked. The coarse-pointer figure is a lower default for touch devices, where per-tab memory
 * is tighter. Both are assumptions, not measured on devices. */
export const SAMPLE_BUDGET_FINE_BYTES = 256 * MB;
export const SAMPLE_BUDGET_COARSE_BYTES = 128 * MB;

export function sampleBudgetBytes(coarsePointer: boolean): number {
  return coarsePointer ? SAMPLE_BUDGET_COARSE_BYTES : SAMPLE_BUDGET_FINE_BYTES;
}

export function createEmptyPattern(name: string, bars = 1): Pattern {
  return { id: nextId("pattern"), name, bars, notes: {} };
}

export function createInitialProject(
  name = "Untitled Project",
  trackCount = DEFAULT_TRACK_COUNT,
  beatsPerBar = DEFAULT_BEATS_PER_BAR,
  bpm = DEFAULT_BPM,
  swing = DEFAULT_SWING,
): Project {
  const firstPattern = createEmptyPattern("Pattern A", 1);
  return {
    id: nextId("project"),
    name,
    bpm,
    swing,
    beatsPerBar,
    tracks: createInitialTracks(trackCount),
    patterns: [firstPattern],
    patternChain: [{ id: nextId("chain"), patternId: firstPattern.id }],
    master: { fx: [], automation: [] },
    assets: [],
  };
}

export function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

export function setBpm(project: Project, bpm: number): Project {
  return { ...project, bpm: clampBpm(bpm) };
}

export function clampSwing(swing: number): number {
  return Math.min(MAX_SWING, Math.max(MIN_SWING, swing));
}

export function setSwing(project: Project, swing: number): Project {
  return { ...project, swing: clampSwing(swing) };
}

export function renameProject(project: Project, name: string): Project {
  return { ...project, name };
}

// --- assets (the project-level Asset Bin) ---

/** Adds a new Asset to the bin, or upserts one whose id already exists (e.g. re-registering
 * an asset's engine-side sample after a project reload — see remapAssetIds). Does not assign
 * it to any track; see assignAsset for that. */
export function addAsset(project: Project, asset: Asset): Project {
  const exists = project.assets.some((a) => a.id === asset.id);
  const assets = exists ? project.assets.map((a) => (a.id === asset.id ? asset : a)) : [...project.assets, asset];
  return { ...project, assets };
}

/** Assigns an already-imported/resampled Asset to a track (also updating the track's display
 * name to the asset's, matching the old one-step "load a sample onto a track" UX) — a no-op
 * if the asset id isn't in the bin. The same asset can be assigned to any number of tracks;
 * assigning a second one to a track simply replaces its previous assetId. */
export function assignAsset(project: Project, trackId: TrackId, assetId: AssetId): Project {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) return project;
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, assetId, name: asset.name } : t)),
  };
}

export function renameAsset(project: Project, assetId: AssetId, name: string): Project {
  return { ...project, assets: project.assets.map((a) => (a.id === assetId ? { ...a, name } : a)) };
}

/** Removes an Asset from the bin and clears it from every track that referenced it (a track
 * with a dangling assetId would otherwise silently keep "playing" an asset the bin no longer
 * lists) — "removing/renaming an asset should update project state consistently". */
export function removeAsset(project: Project, assetId: AssetId): Project {
  return {
    ...project,
    assets: project.assets.filter((a) => a.id !== assetId),
    tracks: project.tracks.map((t) => (t.assetId === assetId ? { ...t, assetId: null } : t)),
  };
}

// --- mixer (per-track volume/mute/solo — see types.ts's effectiveTrackGain for how these
// combine, and src/audio/mixer.ts for how the result reaches the engine) ---

export function clampTrackVolume(volume: number): number {
  return Math.min(MAX_TRACK_VOLUME, Math.max(MIN_TRACK_VOLUME, volume));
}

export function setTrackVolume(project: Project, trackId: TrackId, volume: number): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, volume: clampTrackVolume(volume) } : t)),
  };
}

export function setTrackMuted(project: Project, trackId: TrackId, muted: boolean): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, muted } : t)) };
}

export function setTrackSoloed(project: Project, trackId: TrackId, soloed: boolean): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, soloed } : t)) };
}

// --- playback mode / voice mode (ECS-82/ECS-87 — see types.ts's PlaybackMode/VoiceMode doc
// comments for the behavior each value produces) ---

export function setTrackPlaybackMode(project: Project, trackId: TrackId, playbackMode: PlaybackMode): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, playbackMode } : t)) };
}

export function setTrackVoiceMode(project: Project, trackId: TrackId, voiceMode: VoiceMode): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, voiceMode } : t)) };
}

// --- patterns ---

export function addPattern(project: Project, name?: string, bars = 1): Project {
  const pattern = createEmptyPattern(name ?? `Pattern ${String.fromCharCode(65 + project.patterns.length)}`, bars);
  return { ...project, patterns: [...project.patterns, pattern] };
}

export function duplicatePattern(project: Project, patternId: PatternId): Project {
  const source = project.patterns.find((p) => p.id === patternId);
  if (!source) return project;
  const copy: Pattern = {
    ...source,
    id: nextId("pattern"),
    name: `${source.name} copy`,
    notes: { ...source.notes },
  };
  return { ...project, patterns: [...project.patterns, copy] };
}

/** Removes a pattern and every queue entry referencing it. Refuses to remove the project's
 * last remaining pattern — a project always needs at least one pattern to edit. If the removed
 * pattern was the queue's only occupant (possible even with other patterns still in the
 * project, if they were never queued), falls back to a fresh single entry for the new first
 * remaining pattern — the queue is never allowed to go empty (see Project.patternChain). */
export function removePattern(project: Project, patternId: PatternId): Project {
  if (project.patterns.length <= 1) return project;
  const patterns = project.patterns.filter((p) => p.id !== patternId);
  const patternChain = project.patternChain.filter((e) => e.patternId !== patternId);
  return {
    ...project,
    patterns,
    patternChain: patternChain.length > 0 ? patternChain : [{ id: nextId("chain"), patternId: patterns[0].id }],
  };
}

export function renamePattern(project: Project, patternId: PatternId, name: string): Project {
  return { ...project, patterns: project.patterns.map((p) => (p.id === patternId ? { ...p, name } : p)) };
}

export function setPatternBars(project: Project, patternId: PatternId, bars: number): Project {
  return {
    ...project,
    patterns: project.patterns.map((p) => (p.id === patternId ? notes.setBars(p, project.beatsPerBar, bars) : p)),
  };
}

function updatePattern(project: Project, patternId: PatternId, update: (pattern: Pattern) => Pattern): Project {
  return {
    ...project,
    patterns: project.patterns.map((p) => (p.id === patternId ? update(p) : p)),
  };
}

export function addNote(project: Project, patternId: PatternId, trackId: TrackId, start: number): Project {
  return updatePattern(project, patternId, (p) => notes.addNote(p, project.beatsPerBar, trackId, start));
}

export function removeNote(project: Project, patternId: PatternId, noteId: NoteId): Project {
  return updatePattern(project, patternId, (p) => notes.removeNote(p, noteId));
}

export function clearTrackNotes(project: Project, patternId: PatternId, trackId: TrackId): Project {
  return updatePattern(project, patternId, (p) => notes.clearTrackNotes(p, trackId));
}

/** ECS-112. Unlike the other note operations above, the caller (App.tsx) also needs the
 * pasted/skipped counts for its transient feedback message, so this can't be a one-line
 * updatePattern call — it does the same pattern lookup/replace by hand. */
export function pasteNotes(
  project: Project,
  patternId: PatternId,
  trackId: TrackId,
  copied: notes.CopiedNote[],
): { project: Project; pasted: number; skipped: number } {
  const pattern = project.patterns.find((p) => p.id === patternId);
  if (!pattern) return { project, pasted: 0, skipped: copied.length };
  const result = notes.pasteNotes(pattern, project.beatsPerBar, trackId, copied);
  return {
    project: { ...project, patterns: project.patterns.map((p) => (p.id === patternId ? result.pattern : p)) },
    pasted: result.pasted,
    skipped: result.skipped,
  };
}

export function resizeNote(
  project: Project,
  patternId: PatternId,
  noteId: NoteId,
  duration: number,
  resolution?: number,
): Project {
  return updatePattern(project, patternId, (p) => notes.resizeNote(p, project.beatsPerBar, noteId, duration, resolution));
}

export function moveNote(project: Project, patternId: PatternId, noteId: NoteId, start: number, resolution?: number): Project {
  return updatePattern(project, patternId, (p) => notes.moveNote(p, project.beatsPerBar, noteId, start, resolution));
}

// --- pattern queue (Project.patternChain — see its doc comment) ---

/** Inserts `patternId` into the queue immediately after `afterEntryId` (falling back to the
 * end of the queue if that id is null or no longer present — e.g. its own pattern was deleted
 * out from under it), so a freshly-queued pattern plays at the very next completion boundary
 * rather than waiting for everything already queued ahead of it. The entry stays in the queue
 * (this never "consumes" it) — the caller is expected to pass Transport.getCurrentChainEntryId()
 * as `afterEntryId` so "queue next" means next relative to whatever's actually playing. */
export function queuePatternNext(project: Project, patternId: PatternId, afterEntryId: ChainEntryId | null): Project {
  const chain = project.patternChain;
  const afterIndex = afterEntryId ? chain.findIndex((e) => e.id === afterEntryId) : -1;
  const insertAt = afterIndex === -1 ? chain.length : afterIndex + 1;
  const entry: ChainEntry = { id: nextId("chain"), patternId };
  return { ...project, patternChain: [...chain.slice(0, insertAt), entry, ...chain.slice(insertAt)] };
}

/** Removes every queue entry for `patternId`. Refused (a no-op) if that would empty the queue
 * — the queue always needs at least one entry to loop (see Project.patternChain). */
export function removePatternFromQueue(project: Project, patternId: PatternId): Project {
  const patternChain = project.patternChain.filter((e) => e.patternId !== patternId);
  if (patternChain.length === 0) return project;
  return { ...project, patternChain };
}

/** General-purpose queue setter — not reachable from the UI (there's no arbitrary multi-entry
 * queue editor any more), but still useful for tests and for constructing/loading a project
 * with a specific queue directly. Unlike queuePatternNext/removePatternFromQueue, this does not
 * enforce the non-empty guarantee itself; callers that bypass the UI are responsible for it. */
export function setChain(project: Project, patternChain: ChainEntry[]): Project {
  return { ...project, patternChain };
}

// --- asset id remapping (see src/persistence/projectStore.ts's module doc comment) ---

/** Rewrites every AssetId reference (the Asset Bin itself, every track's assignment) through
 * `idMap` — used after reloading a saved project, once each asset's raw bytes have been
 * re-registered with the (fresh, freshly-numbered) live AudioRuntime, since AssetId is the
 * same numeric space as webdsp's SampleId (see types.ts's AssetId doc comment) and a fresh
 * runtime almost never reproduces the same ids a previous session had. Ids missing from
 * `idMap` are left as they were — a no-op for an asset that failed to reload rather than a
 * crash. */
export function remapAssetIds(project: Project, idMap: Map<AssetId, AssetId>): Project {
  const remap = (id: AssetId | null): AssetId | null => (id != null && idMap.has(id) ? idMap.get(id)! : id);
  return {
    ...project,
    assets: project.assets.map((a) => ({ ...a, id: remap(a.id) ?? a.id })),
    tracks: project.tracks.map((t) => ({ ...t, assetId: remap(t.assetId) })),
  };
}
