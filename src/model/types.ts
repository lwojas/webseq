// The tracker's own application model. Deliberately independent of React and of webdsp:
// nothing here imports "webdsp" or any React type, and nothing here knows what an
// AudioContext, a BusId, or a VoiceHandle is — see src/audio/ for the one place this model
// gets translated into webdsp calls. A Project owns everything: project-wide config,
// samples, tracks (with their FX chains), patterns, and the pattern chain. A Pattern owns
// only musical events (notes) for a given arrangement — it has its own length in bars but no
// tempo of its own; every pattern in a project plays at the project's one BPM, which is what
// makes chaining patterns together musically deterministic (see ARCHITECTURE notes in
// README.md).

export type TrackId = string;
export type PatternId = string;
export type NoteId = string;
export type ChainEntryId = string;
export type FxId = string;
export type SampleId = number;
/** Project-level Asset identity. Kept as the same numeric space as SampleId rather than a
 * second id scheme: an Asset's id is literally the webdsp SampleId it round-trips through
 * (see remapAssetIds in project.ts, and persistence/projectStore.ts's module doc comment for
 * why that remap exists at all), so a track referencing an asset can hand that id straight to
 * webdsp's ScheduledEvent.sampleId with no translation layer. */
export type AssetId = SampleId;

/** Which processing target an FX/automation operation applies to — an individual track, or
 * the project-wide master bus. Kept as a small union rather than a special "master track" in
 * the `tracks` array, per the brief: MASTER is a bus/control entity, not a sample-producing
 * track. */
export type FxTarget = TrackId | "master";

/** A single track/pad. Generic on purpose — the model has no idea what "kick" or "snare"
 * means, only that a track has a sample assigned to it (or not), an ordered FX chain, and
 * optional automation for that chain. Track identity is stable across patterns: a pattern
 * only ever stores *notes* referencing a trackId, never a copy of the track itself, so
 * assigning a sample or adding FX to a track affects every pattern that references it. */
export interface Track {
  id: TrackId;
  /** Display name — the assigned asset's name by default, editable later if needed. */
  name: string;
  /** The project-level Asset this track plays, or null if none has been assigned yet. A
   * track never owns audio directly — it only ever references an Asset by id, so the same
   * Asset (imported or resampled) can be assigned to any number of tracks. */
  assetId: AssetId | null;
  /** Ordered chain of FX processing this track's voices before the mixer. Order is explicit
   * and meaningful (see FxInstance), even though today's audio engine only has two FX types
   * and applies them in a fixed native order — see src/audio/applyFx.ts. */
  fx: FxInstance[];
  /** Optional per-(fx, parameter) automation lanes for this track. Separate from `fx` itself
   * — an FX's automation can be cleared without deleting the FX or resetting its base
   * parameter values (see AutomationLane doc comment). */
  automation: AutomationLane[];
  /** Linear gain multiplier for this track's bus (see project.ts's DEFAULT_TRACK_VOLUME) —
   * same "linear, not dB" convention webdsp itself uses for TriggerParams.gain. Pushed to the
   * engine as NodeParam.BusGain (see src/audio/mixer.ts), the same per-bus real-time parameter
   * FX params already use — not a sequencer-tick-scheduled value. */
  volume: number;
  /** When true, this track is silent regardless of `volume` — see effectiveTrackGain. */
  muted: boolean;
  /** When true, this track is soloed: while any track in the project is soloed, every
   * non-soloed track is silenced (see effectiveTrackGain) — standard multi-solo behavior, not
   * exclusive/single-select. */
  soloed: boolean;
}

/** The project-wide master bus. Not a Track (see FxTarget doc comment): it has an FX chain
 * and automation shaped identically to a track's, but no sample/notes of its own — it only
 * ever processes the sum of every track's output. */
export interface MasterBus {
  fx: FxInstance[];
  automation: AutomationLane[];
}

export type FxType = "filter" | "delay" | "reverb";

/** One FX in a track's or master's ordered chain. `params` is a flat, generic key->value map
 * (see fx.ts's FX_DEFS for what keys each `type` defines and their defaults/ranges) rather
 * than a per-type interface, so the chain, the reducer, and the generic module-panel UI never
 * need a switch statement over FX type — only fx.ts's registry and audio/applyFx.ts (the
 * translation to webdsp's NodeParam ids) know what a "filter", "delay", or "reverb"
 * actually is. */
export interface FxInstance {
  id: FxId;
  type: FxType;
  enabled: boolean;
  params: Record<string, number>;
}

/** One point in an automation lane: at `position` (beats, pattern-local — always musical
 * time, never wall-clock), the parameter takes `value`. See AutomationLane doc comment for
 * interpolation/end-of-lane behavior. */
export interface AutomationEvent {
  position: number;
  value: number;
}

/** Automation for exactly one parameter of exactly one FX instance, e.g. "track 2's filter
 * cutoff over the pattern". Deliberately simple: a sparse, sorted list of (position, value)
 * points with LINEAR interpolation between consecutive points (see automation.ts's
 * valueAtBeat) — no Bezier curves, no envelopes. Before the first point, the lane holds that
 * first point's value; from the last point onward (including when a pattern loops past a
 * lane with no point at its very end), it holds the last point's value — i.e. automation
 * never "runs out" mid-loop, it just stops changing. An FX's automation is independent of its
 * base `params`: removing every event from a lane (or the lane itself) leaves the FX's own
 * `params` untouched, since a lane only ever *overrides* the current value while at least one
 * event exists at or before the playhead. */
export interface AutomationLane {
  fxId: FxId;
  /** One of the target FX's `params` keys (see FX_DEFS in fx.ts). */
  parameter: string;
  /** Sorted ascending by `position`. */
  events: AutomationEvent[];
}

/** One musical event on a track, scoped to a single Pattern. Position and duration are in
 * "beats" — a grid unit whose real-world meaning (a sixteenth note in 4/4 today) is fixed by
 * Project.beatsPerBar, independent of how many bars a given pattern has. */
export interface Note {
  id: NoteId;
  trackId: TrackId;
  /** Start position in beats from the start of the pattern, 0-based. */
  start: number;
  /** Length in beats. Always > 0. */
  duration: number;
  /** 0..1, forwarded to the engine as gain. */
  velocity: number;
}

/** One arrangement of musical events. Has its own length in bars but deliberately no BPM of
 * its own — see Project.bpm's doc comment for why that's required for deterministic
 * chaining. Notes are a flat, independently-addressable Record (not per-track nested arrays
 * or a fixed-size grid), so adding/removing/resizing a note is an O(1) map update and nothing
 * about the shape assumes any particular bar count or beats-per-bar. */
export interface Pattern {
  id: PatternId;
  name: string;
  /** Loop length in bars. Different patterns in the same project may have different
   * lengths — see Project.beatsPerBar for how this becomes a beat count. */
  bars: number;
  notes: Record<NoteId, Note>;
}

/** One slot in the project's pattern chain. A separate `id` (not just the patternId) because
 * the same pattern may appear more than once in the chain (e.g. `A -> A -> B -> C -> A`), and
 * each occurrence needs a stable identity for reordering/removal in the UI. */
export interface ChainEntry {
  id: ChainEntryId;
  patternId: PatternId;
}

/** A reusable audio resource owned by the project (the "Asset Bin") — never by a single
 * track. Tracks reference one by `id` (see Track.assetId); the same Asset can be assigned to
 * any number of tracks, and removing/renaming it here updates every reference consistently
 * (see project.ts's removeAsset/renameAsset). An Asset's actual audio bytes are kept
 * separately in IndexedDB (see src/persistence/) — this is metadata only, mirroring (a
 * subset of) webdsp's SampleMetadata but kept as this project's own type so this file has
 * zero dependency on the audio-engine package. */
export interface Asset {
  id: AssetId;
  name: string;
  /** Only "audio" for now — kept as a discriminant rather than assumed, so a future asset
   * type (e.g. a MIDI clip) doesn't need every existing Asset call site to change shape. */
  type: "audio";
  /** Seconds. */
  duration: number;
  sampleRate: number;
  channels: number;
  /** Where this Asset's audio came from — an imported file, or a captured pattern
   * resampling (see audio/transport.ts's armResample). Purely informational (e.g. for the
   * Asset Bin UI's origin badge); a resampled Asset behaves exactly like an imported one once
   * created, it is not permanently tied to the pattern that produced it. */
  origin: "import" | "resample";
  /** Only set when origin === "resample": which pattern this was captured from. Historical
   * metadata only — the pattern may since have been edited, renamed, or deleted. */
  sourcePatternId?: PatternId;
}

/** The entire application's state: one project. Owns project-wide configuration, the Asset
 * Bin, every track (with its FX), every pattern, and the pattern chain — see the module doc
 * comment at the top of this file for the Project/Pattern/Track split. */
export interface Project {
  id: string;
  name: string;
  /** BPM, 40..240. Applies to every pattern in the project — see the module doc comment for
   * why patterns don't have independent tempos. */
  bpm: number;
  /** Steps per bar — the grid's horizontal resolution, and the fixed real-world duration of
   * one "beat" everywhere in this model. Project-wide (not per-pattern), and not hardcoded
   * anywhere outside this field. */
  beatsPerBar: number;
  tracks: Track[];
  patterns: Pattern[];
  /** Ordered, possibly-repeating sequence of patterns that plays back continuously, looping
   * from the last entry back to the first — see src/audio/transport.ts. */
  patternChain: ChainEntry[];
  master: MasterBus;
  /** The project-level Asset Bin — see the Asset doc comment. */
  assets: Asset[];
}

export function totalBeats(pattern: Pick<Pattern, "bars">, beatsPerBar: number): number {
  return pattern.bars * beatsPerBar;
}

export function notesForTrack(pattern: Pattern, trackId: TrackId): Note[] {
  const result: Note[] = [];
  for (const note of Object.values(pattern.notes)) {
    if (note.trackId === trackId) result.push(note);
  }
  return result.sort((a, b) => a.start - b.start);
}

export function patternById(project: Project, patternId: PatternId): Pattern | undefined {
  return project.patterns.find((p) => p.id === patternId);
}

export function trackById(project: Project, trackId: TrackId): Track | undefined {
  return project.tracks.find((t) => t.id === trackId);
}

/** Resolves one step of the pattern chain by its 0-based occurrence count (not clamped to
 * chain length — callers pass an ever-increasing step counter and this wraps it), so a chain
 * edit naturally only ever changes which pattern *future* steps resolve to. Returns null for
 * an empty chain or a chain entry whose pattern has been deleted, so callers can skip a step
 * without crashing (see Transport.tick()). */
export function resolveChainStep(
  project: Project,
  stepIndex: number,
): { entry: ChainEntry; pattern: Pattern } | null {
  const chain = project.patternChain;
  if (chain.length === 0) return null;
  const entry = chain[((stepIndex % chain.length) + chain.length) % chain.length];
  const pattern = patternById(project, entry.patternId);
  if (!pattern) return null;
  return { entry, pattern };
}

/** Returns the FX chain + automation array for either a track or the master bus — the one
 * place that needs to branch on FxTarget so the rest of the model/reducer can stay generic
 * over "track or master". */
export function fxOwner(project: Project, target: FxTarget): { fx: FxInstance[]; automation: AutomationLane[] } | null {
  if (target === "master") return project.master;
  return trackById(project, target) ?? null;
}

/** The gain actually audible for `track` once mute/solo are accounted for: 0 if it's muted,
 * or if any *other* track in the project is soloed and this one isn't; otherwise its own
 * `volume`. Pure model-level policy, independent of webdsp — src/audio/mixer.ts just pushes
 * whatever this returns straight to the engine's BusGain, it has no mute/solo concept itself. */
export function effectiveTrackGain(project: Project, track: Track): number {
  if (track.muted) return 0;
  const anySoloed = project.tracks.some((t) => t.soloed);
  if (anySoloed && !track.soloed) return 0;
  return track.volume;
}
