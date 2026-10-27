// The Composer: a linear song made of lanes, each a row of sequence instances snapped to whole bars.
// Pure functions over Project, like the rest of src/model.
//
//   Composer -> lane[] -> sequence[]
//
// A SEQUENCE is not a pointer at a shared pattern. Each one owns a pattern of its own (a clone made when
// it is added from the launcher or duplicated), stored in Project.patterns with `composerOwned: true`.
// That is what makes instances independent AND lets the existing sequencer edit one through the same
// patternId-based actions it already has — there is no second editing path. Its length is its pattern's
// `bars`, and its name is the pattern's name.
//
// A LANE is a parallel stream: sequences on one lane never overlap (a rule of this module, not of the UI:
// every mutator returns the project UNCHANGED, same reference, if the result would overlap or leave the
// timeline, and never moves a neighbour); sequences on different lanes play together. A lane is a place on the
// timeline and may carry musical MODIFIERS (transpose, velocity, gate) applied to its notes before they are played.
// It has nothing to do with tracks, FX, buses or routing: those stay exactly as they are, and a sequence plays every
// track its pattern has notes for.
//
// SONG MODE reads this model directly: songInstances() lists every sequence on every lane in play order
// and the transport schedules those (audio/transport.ts), through the same note scheduling the pattern queue uses.
// Nothing here is converted into a patternChain. Audio automation is not part of it either: tracks' and the master's
// existing automation lanes are replayed over the sequences they apply to (automationAppliesTo).
import { MAX_NOTE_PITCH, MAX_PATTERN_BARS, MIN_NOTE_PITCH, extendBarsByRepeat } from "./notes";

/** The shortest a modifier can make a note (a quarter of a beat). */
const MIN_NOTE_DURATION = 0.25;
import type { Composer, ComposerLane, ComposerSequence, LaneId, LaneModifiers, Note, Pattern, PatternId, Project, SequenceId, TrackId } from "./types";

/** Colours a sequence can take. Instance data, so these are literal values rather than theme tokens. */
export const COMPOSER_COLORS = ["#3d8bff", "#f0a83c", "#29e0e0", "#b46cf0", "#5fd16a", "#e0527c", "#e0d452", "#8a95a6"] as const;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- reading ---

export function composerLanes(project: Project): ComposerLane[] {
  return project.composer?.lanes ?? [];
}

export function laneById(project: Project, id: LaneId | null): ComposerLane | undefined {
  return id === null ? undefined : composerLanes(project).find((l) => l.id === id);
}

/** Every sequence with the lane it is on, lanes top to bottom, each lane left to right. */
export function allSequences(project: Project): { seq: ComposerSequence; lane: ComposerLane }[] {
  return composerLanes(project).flatMap((lane) => lane.sequences.map((seq) => ({ seq, lane })));
}

export function sequenceById(project: Project, id: SequenceId | null): ComposerSequence | undefined {
  return id === null ? undefined : allSequences(project).find((e) => e.seq.id === id)?.seq;
}

export function laneOfSequence(project: Project, id: SequenceId | null): ComposerLane | undefined {
  return id === null ? undefined : allSequences(project).find((e) => e.seq.id === id)?.lane;
}

export function sequenceForPattern(project: Project, patternId: PatternId): ComposerSequence | undefined {
  return allSequences(project).find((e) => e.seq.patternId === patternId)?.seq;
}

function patternOf(project: Project, seq: ComposerSequence): Pattern | undefined {
  return project.patterns.find((p) => p.id === seq.patternId);
}

/** Length in bars (its pattern's). A sequence whose pattern is missing counts as 1 bar so a damaged
 * file still lays out. */
export function sequenceBars(project: Project, seq: ComposerSequence): number {
  return patternOf(project, seq)?.bars ?? 1;
}

export function sequenceName(project: Project, seq: ComposerSequence): string {
  return patternOf(project, seq)?.name ?? "Sequence";
}

export function sequenceEnd(project: Project, seq: ComposerSequence): number {
  return seq.start + sequenceBars(project, seq);
}

/** The bar just past the last sequence of `lane` (0 for an empty lane). */
export function laneEnd(project: Project, lane: ComposerLane | undefined): number {
  return (lane?.sequences ?? []).reduce((end, s) => Math.max(end, sequenceEnd(project, s)), 0);
}

/** The bar just past the last sequence on any lane (0 for an empty song). */
export function timelineEnd(project: Project): number {
  return composerLanes(project).reduce((end, lane) => Math.max(end, laneEnd(project, lane)), 0);
}

/** Patterns the launcher / queue / MIDI slots show: everything except Composer-owned content. */
export function launcherPatterns(patterns: Pattern[]): Pattern[] {
  return patterns.filter((p) => !p.composerOwned);
}

// --- placement within a lane ---

/** True when [start, start+bars) is on the timeline and clear of every sequence on the lane but `ignoreId`. */
export function canPlace(project: Project, laneId: LaneId, start: number, bars: number, ignoreId?: SequenceId): boolean {
  const lane = laneById(project, laneId);
  if (!lane || !Number.isInteger(start) || !Number.isInteger(bars) || start < 0 || bars < 1 || bars > MAX_PATTERN_BARS) return false;
  return lane.sequences.every((s) => s.id === ignoreId || start + bars <= s.start || s.start + sequenceBars(project, s) <= start);
}

/** The first start at or after `from` on `laneId` where `bars` fit. Always exists (past the end). */
export function firstFreeStart(project: Project, laneId: LaneId, bars: number, from = 0, ignoreId?: SequenceId): number {
  let start = Math.max(0, Math.round(from));
  const sorted = [...(laneById(project, laneId)?.sequences ?? [])].filter((s) => s.id !== ignoreId).sort((a, b) => a.start - b.start);
  for (const s of sorted) {
    if (start + bars <= s.start) break;
    if (s.start + sequenceBars(project, s) > start) start = s.start + sequenceBars(project, s);
  }
  return start;
}

/** How many bars `seq` can grow to before it would touch the next sequence on its lane (or the pattern cap). */
export function maxSequenceBars(project: Project, seq: ComposerSequence): number {
  const lane = laneOfSequence(project, seq.id);
  const next = (lane?.sequences ?? [])
    .filter((s) => s.id !== seq.id && s.start >= seq.start)
    .reduce((min, s) => Math.min(min, s.start), Infinity);
  return Math.min(MAX_PATTERN_BARS, next - seq.start);
}

/** Whether the sequencer's own bars stepper may set `bars` on `patternId`: always for a launcher
 * pattern, and for a sequence's pattern only if it still clears the next sequence on its lane. */
export function barsAllowedForPattern(project: Project, patternId: PatternId, bars: number): boolean {
  const seq = sequenceForPattern(project, patternId);
  return !seq || Math.round(bars) <= maxSequenceBars(project, seq);
}

// --- writing ---

function withLanes(project: Project, lanes: ComposerLane[]): Project {
  const composer: Composer = { lanes };
  return { ...project, composer };
}

function mapLane(project: Project, laneId: LaneId, update: (lane: ComposerLane) => ComposerLane): Project {
  return withLanes(project, composerLanes(project).map((l) => (l.id === laneId ? update(l) : l)));
}

function newLane(project: Project, name?: string): ComposerLane {
  return { id: nextId("lane"), name: name ?? `Lane ${composerLanes(project).length + 1}`, sequences: [] };
}

/** Adds an empty lane at the bottom. */
export function addLane(project: Project, name?: string): Project {
  return withLanes(project, [...composerLanes(project), newLane(project, name)]);
}

export function renameLane(project: Project, laneId: LaneId, name: string): Project {
  return laneById(project, laneId) ? mapLane(project, laneId, (l) => ({ ...l, name })) : project;
}

/** Moves a lane to `index` (clamped) in the top-to-bottom order. Order matters: it decides which lane
 * claims a track that several name, and which lane master-level automation follows. */
export function moveLane(project: Project, laneId: LaneId, index: number): Project {
  const lanes = composerLanes(project);
  const from = lanes.findIndex((l) => l.id === laneId);
  const to = Math.min(lanes.length - 1, Math.max(0, index));
  if (from === -1 || from === to) return project;
  const next = lanes.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return withLanes(project, next);
}

/** Sets (part of) a lane's modifiers, clamped to their ranges; all-default modifiers are stored as none. */
export function setLaneModifiers(project: Project, laneId: LaneId, patch: Partial<LaneModifiers>): Project {
  const lane = laneById(project, laneId);
  if (!lane) return project;
  const next = clampModifiers({ ...laneModifiers(lane), ...patch });
  const modifiers = isIdentity(next) ? undefined : next;
  if (modifiers === undefined && lane.modifiers === undefined) return project;
  return mapLane(project, laneId, ({ modifiers: _old, ...rest }) => (modifiers ? { ...rest, modifiers } : rest));
}

/** Removes a lane together with its sequences' patterns. */
export function removeLane(project: Project, laneId: LaneId): Project {
  const lane = laneById(project, laneId);
  if (!lane) return project;
  const gone = new Set(lane.sequences.map((s) => s.patternId));
  return { ...withLanes(project, composerLanes(project).filter((l) => l.id !== laneId)), patterns: project.patterns.filter((p) => !gone.has(p.id)) };
}

/** A pattern's content as an independent copy: fresh id, every note a fresh object. */
function clonePattern(source: Pick<Pattern, "name" | "bars" | "notes">): Pattern {
  const notes: Record<string, Note> = {};
  for (const [id, note] of Object.entries(source.notes)) notes[id] = { ...note };
  return { id: nextId("pattern"), name: source.name, bars: source.bars, notes, composerOwned: true };
}

/** A sequence's content as plain data (the clipboard's contents). */
export interface SequenceClip {
  name: string;
  bars: number;
  notes: Record<string, Note>;
  color: string;
}

export function copySequence(project: Project, id: SequenceId): SequenceClip | null {
  const seq = sequenceById(project, id);
  const pattern = seq && patternOf(project, seq);
  if (!seq || !pattern) return null;
  const { name, bars, notes } = clonePattern(pattern);
  return { name, bars, notes, color: seq.color };
}

function nextColor(project: Project): string {
  return COMPOSER_COLORS[allSequences(project).length % COMPOSER_COLORS.length];
}

/** The lane to use: `laneId` if it exists, else the first lane, else (nothing composed yet) a new one. */
function ensureLane(project: Project, laneId: LaneId | null | undefined): { project: Project; laneId: LaneId } {
  const lane = laneById(project, laneId ?? null) ?? composerLanes(project)[0];
  if (lane) return { project, laneId: lane.id };
  const created = addLane(project);
  return { project: created, laneId: composerLanes(created)[0].id };
}

/** Adds a sequence on `laneId` at `start` with its own content: a copy of `clip`, or an empty `bars`-bar
 * pattern. Returns the project unchanged if it does not fit at `start` (callers choose `start` with
 * firstFreeStart). With no lane yet, one is created. */
export function addSequence(project: Project, laneId: LaneId | null | undefined, start: number, content: SequenceClip | { name: string; bars: number; notes?: undefined; color?: undefined }): Project {
  const target = ensureLane(project, laneId);
  if (!canPlace(target.project, target.laneId, start, content.bars)) return project;
  const pattern = clonePattern({ ...content, notes: content.notes ?? {} });
  const seq: ComposerSequence = { id: nextId("seq"), patternId: pattern.id, start, color: content.color ?? nextColor(target.project) };
  const withPattern = { ...target.project, patterns: [...target.project.patterns, pattern] }; // composer patterns stay last
  return mapLane(withPattern, target.laneId, (l) => ({ ...l, sequences: [...l.sequences, seq].sort((a, b) => a.start - b.start) }));
}

/** Whether `bars` bars can be inserted at bar `start` on `laneId` (the first lane if none is given; with no lane yet, one would be
 * created, so only the bounds matter). The Composer's marker decides `start`, and an insert is refused, not moved, when this is false. */
export function canInsertAt(project: Project, laneId: LaneId | null | undefined, start: number, bars: number): boolean {
  const lane = laneById(project, laneId ?? null) ?? composerLanes(project)[0];
  if (lane) return canPlace(project, lane.id, start, bars);
  return Number.isInteger(start) && Number.isInteger(bars) && start >= 0 && bars >= 1 && bars <= MAX_PATTERN_BARS;
}

/** "Add to Composer": a copy of launcher pattern `patternId`, at bar `at` of the lane (rejected if it does not fit there) or,
 * without `at`, after the last sequence of the lane. */
export function addPatternToComposer(project: Project, patternId: PatternId, laneId?: LaneId | null, at?: number): Project {
  const source = project.patterns.find((p) => p.id === patternId);
  if (!source) return project;
  const target = ensureLane(project, laneId);
  const end = at ?? laneEnd(target.project, laneById(target.project, target.laneId));
  return addSequence(target.project, target.laneId, end, { name: source.name, bars: source.bars, notes: source.notes, color: nextColor(project) });
}

/** A new empty 1-bar sequence at bar `at` of the lane (rejected if it does not fit there) or, without `at`, after the last one. */
export function addBlankSequence(project: Project, laneId?: LaneId | null, at?: number): Project {
  const target = ensureLane(project, laneId);
  const n = allSequences(target.project).length + 1;
  return addSequence(target.project, target.laneId, at ?? laneEnd(target.project, laneById(target.project, target.laneId)), { name: `Sequence ${n}`, bars: 1 });
}

/** An independent copy of `id`, on the same lane, in the first free slot at/after the original's end. */
export function duplicateSequence(project: Project, id: SequenceId): Project {
  const clip = copySequence(project, id);
  const seq = sequenceById(project, id);
  const lane = laneOfSequence(project, id);
  if (!clip || !seq || !lane) return project;
  return addSequence(project, lane.id, firstFreeStart(project, lane.id, clip.bars, sequenceEnd(project, seq)), clip);
}

/** Pastes `clip` as a new sequence on `laneId`: exactly at bar `at` (rejected if it does not fit) when `exact`, else at the first
 * free slot at or after `at`. */
export function pasteSequence(project: Project, clip: SequenceClip, laneId: LaneId | null | undefined, at: number, exact = false): Project {
  const target = ensureLane(project, laneId);
  if (exact) return addSequence(target.project, target.laneId, at, clip);
  return addSequence(target.project, target.laneId, firstFreeStart(target.project, target.laneId, clip.bars, at), clip);
}

/** Moves a sequence to bar `start` (and, if given, onto another lane); rejected (unchanged) if it would
 * overlap on the destination lane or leave the timeline. */
export function moveSequence(project: Project, id: SequenceId, start: number, laneId?: LaneId): Project {
  const seq = sequenceById(project, id);
  const from = laneOfSequence(project, id);
  const to = laneById(project, laneId ?? from?.id ?? null);
  if (!seq || !from || !to || (seq.start === start && from.id === to.id)) return project;
  if (!canPlace(project, to.id, start, sequenceBars(project, seq), id)) return project;
  const moved = { ...seq, start };
  return withLanes(
    project,
    composerLanes(project).map((l) => {
      if (l.id === from.id && l.id === to.id) return { ...l, sequences: l.sequences.map((s) => (s.id === id ? moved : s)).sort((a, b) => a.start - b.start) };
      if (l.id === from.id) return { ...l, sequences: l.sequences.filter((s) => s.id !== id) };
      if (l.id === to.id) return { ...l, sequences: [...l.sequences, moved].sort((a, b) => a.start - b.start) };
      return l;
    }),
  );
}

/** Sets a sequence's length in bars (its pattern's); rejected if it would run into the next sequence on
 * its lane. Shrinking drops notes past the new end, exactly as the sequencer's bars stepper does. Growing fills the new bars
 * with repeats of the sequence's own content (notes.ts extendBarsByRepeat), so dragging a sequence longer loops it rather than
 * adding silence. */
export function resizeSequence(project: Project, id: SequenceId, bars: number): Project {
  const seq = sequenceById(project, id);
  if (!seq || !Number.isInteger(bars) || bars < 1 || bars > maxSequenceBars(project, seq)) return project;
  return {
    ...project,
    patterns: project.patterns.map((p) => {
      if (p.id !== seq.patternId || p.bars === bars) return p;
      if (bars > p.bars) return extendBarsByRepeat(p, project.beatsPerBar, bars);
      const total = bars * project.beatsPerBar;
      const notes: Pattern["notes"] = {};
      for (const [noteId, note] of Object.entries(p.notes)) if (note.start < total) notes[noteId] = note;
      return { ...p, bars, notes };
    }),
  };
}

export function setSequenceColor(project: Project, id: SequenceId, color: string): Project {
  const seq = sequenceById(project, id);
  const lane = laneOfSequence(project, id);
  if (!seq || !lane || seq.color === color) return project;
  return mapLane(project, lane.id, (l) => ({ ...l, sequences: l.sequences.map((s) => (s.id === id ? { ...s, color } : s)) }));
}

/** Removes a sequence together with the pattern it owned. */
export function removeSequence(project: Project, id: SequenceId): Project {
  const seq = sequenceById(project, id);
  const lane = laneOfSequence(project, id);
  if (!seq || !lane) return project;
  return { ...mapLane(project, lane.id, (l) => ({ ...l, sequences: l.sequences.filter((s) => s.id !== id) })), patterns: project.patterns.filter((p) => p.id !== seq.patternId) };
}

/** Brings a project saved by an earlier Composer up to the current shape: the first one had a single flat `sequences`
 * list (it becomes one lane); the next gave lanes audio fields (`trackIds`, `fx`, `automation`) that no longer exist (they
 * are dropped). Anything already current passes through unchanged. Applied when a project is loaded. */
export function migrateComposer(project: Project): Project {
  const old = project.composer as (Partial<Composer> & { sequences?: ComposerSequence[] }) | undefined;
  if (!old) return project;
  if (!Array.isArray(old.lanes)) {
    const sequences = old.sequences ?? [];
    return { ...project, composer: { lanes: sequences.length > 0 ? [{ id: nextId("lane"), name: "Lane 1", sequences }] : [] } };
  }
  const current = old.lanes.every((l) => !("fx" in l) && !("trackIds" in l) && !("automation" in l));
  if (current) return project;
  const lanes = old.lanes.map((l): ComposerLane => ({ id: l.id, name: l.name, sequences: l.sequences, ...(l.modifiers ? { modifiers: l.modifiers } : {}) }));
  return { ...project, composer: { lanes } };
}

// --- lane modifiers ---

export const DEFAULT_LANE_MODIFIERS: LaneModifiers = { transpose: 0, velocity: 1, gate: 1 };
export const MAX_TRANSPOSE = 24;
export const MIN_VELOCITY_SCALE = 0.1;
export const MAX_VELOCITY_SCALE = 2;
export const MIN_GATE_SCALE = 0.25;
export const MAX_GATE_SCALE = 2;

export function laneModifiers(lane: ComposerLane | undefined): LaneModifiers {
  return lane?.modifiers ?? DEFAULT_LANE_MODIFIERS;
}

function clampModifiers(m: LaneModifiers): LaneModifiers {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const round = (v: number, step: number) => Math.round(v / step) * step;
  return {
    transpose: clamp(Math.round(m.transpose), -MAX_TRANSPOSE, MAX_TRANSPOSE),
    velocity: clamp(round(m.velocity, 0.05), MIN_VELOCITY_SCALE, MAX_VELOCITY_SCALE),
    gate: clamp(round(m.gate, 0.05), MIN_GATE_SCALE, MAX_GATE_SCALE),
  };
}

export function isIdentity(m: LaneModifiers): boolean {
  return m.transpose === 0 && m.velocity === 1 && m.gate === 1;
}

/** "+7 st · vel 80% · gate 50%" (only what differs from default), or "" when the lane has no modifiers. */
export function describeModifiers(m: LaneModifiers): string {
  const parts: string[] = [];
  if (m.transpose !== 0) parts.push(`${m.transpose > 0 ? "+" : ""}${m.transpose} st`);
  if (m.velocity !== 1) parts.push(`vel ${Math.round(m.velocity * 100)}%`);
  if (m.gate !== 1) parts.push(`gate ${Math.round(m.gate * 100)}%`);
  return parts.join(" · ");
}

/** The pattern as the lane plays it: the same notes with the modifiers applied (pitch up by `transpose`, velocity and length
 * scaled). Pure and at the musical level — it returns a Pattern the existing playback compiles like any other, so nothing
 * downstream (instruments, samples, track FX, mixer) knows a modifier exists. No modifiers returns `pattern` itself. Chord
 * notes keep their chord (a chord is a scale-relative shape, not a pitch offset); a pitch is kept within the engine's range. */
export function applyLaneModifiers(pattern: Pattern, m: LaneModifiers): Pattern {
  if (isIdentity(m)) return pattern;
  const notes: Record<string, Note> = {};
  for (const [id, note] of Object.entries(pattern.notes)) {
    const next: Note = { ...note, velocity: Math.min(1, note.velocity * m.velocity), duration: Math.max(MIN_NOTE_DURATION, note.duration * m.gate) };
    if (m.transpose !== 0 && !note.chord) {
      const pitch = Math.max(MIN_NOTE_PITCH, Math.min(MAX_NOTE_PITCH, (note.pitch ?? 0) + m.transpose));
      if (pitch !== 0) next.pitch = pitch;
      else delete next.pitch;
    }
    notes[id] = next;
  }
  return { ...pattern, notes };
}

// --- Song mode: the Composer as a playback source ---

/** What the transport plays: the launcher's pattern queue (`patternChain`) or the Composer song. */
export type PlaybackSource = "pattern" | "song";

/** One sequence as the transport plays it: what, where in the song, and on which lane. */
export interface SongInstance {
  sequenceId: SequenceId;
  laneId: LaneId;
  /** Lane position, top = 0. */
  laneIndex: number;
  /** The sequence's own pattern, as stored (its id is what the editor and the playhead know it by). */
  pattern: Pattern;
  /** The lane's modifiers; the transport plays `applyLaneModifiers(pattern, modifiers)`. */
  modifiers: LaneModifiers;
  /** Beats from the start of the song. */
  startBeat: number;
  /** Length in beats (always > 0). */
  beats: number;
  /** The tracks the pattern has notes for: what "this sequence plays a track" means for that track's automation. */
  noteTracks: ReadonlySet<TrackId>;
}

/** Every sequence of every lane, in the order the transport meets them: by start, ties by lane. Lanes are
 * independent, so instances overlap freely across lanes (never within one) and empty stretches of a lane
 * are simply absent: a gap is silence on that lane while the others carry on. A sequence whose pattern
 * is missing is skipped. Pure; derived from the lanes on every call, never stored. */
export function songInstances(project: Project): SongInstance[] {
  const bpb = project.beatsPerBar;
  const out: SongInstance[] = [];
  composerLanes(project).forEach((lane, laneIndex) => {
    const modifiers = laneModifiers(lane);
    for (const seq of lane.sequences) {
      const pattern = patternOf(project, seq);
      if (!pattern || pattern.bars < 1) continue;
      const noteTracks = new Set(Object.values(pattern.notes).map((n) => n.trackId));
      out.push({ sequenceId: seq.id, laneId: lane.id, laneIndex, pattern, modifiers, startBeat: seq.start * bpb, beats: pattern.bars * bpb, noteTracks });
    }
  });
  return out.sort((a, b) => a.startBeat - b.startBeat || a.laneIndex - b.laneIndex);
}

/** Audio automation is the existing kind — a track's (or the master's) lanes, positions in beats from the start of the
 * pattern — and Song mode replays it exactly as Pattern mode does: from the start of every sequence it applies to. A track's
 * lanes apply to the sequences whose pattern has notes for that track; the master's follow the top-most lane that has
 * sequences (`masterLaneIndex`). The Composer draws the same spans, so what it shows is what plays. */
export function automationAppliesTo(instance: SongInstance, target: "master" | TrackId, masterLaneIndex: number): boolean {
  return target === "master" ? instance.laneIndex === masterLaneIndex : instance.noteTracks.has(target);
}

/** The top-most lane that has a sequence (what the master's pattern-local automation follows). */
export function masterLaneIndex(instances: readonly SongInstance[]): number {
  return instances.reduce((min, i) => Math.min(min, i.laneIndex), Infinity);
}

/** Song length in beats: the end of the latest sequence on any lane (0 when nothing is composed). The
 * song loops here. */
export function songBeats(project: Project): number {
  return songInstances(project).reduce((end, i) => Math.max(end, i.startBeat + i.beats), 0);
}

/** The instances sounding at `songBeat`, with how far into each it is. */
export function activeAt(instances: readonly SongInstance[], songBeat: number): { instance: SongInstance; beat: number }[] {
  return instances.filter((i) => songBeat >= i.startBeat && songBeat < i.startBeat + i.beats).map((instance) => ({ instance, beat: songBeat - instance.startBeat }));
}

/** One line for the Composer's readout while the song plays: what sounds at `songBeat` (lane by lane) and how
 * long until anything starts or ends — "Verse + Verse · bar 3 · change in 1.5 bars". Pure. */
export function describeSongPosition(project: Project, songBeat: number): string {
  const instances = songInstances(project);
  const bpb = project.beatsPerBar;
  const active = activeAt(instances, songBeat);
  const names = active.length > 0 ? active.map((a) => a.instance.pattern.name).join(" + ") : "gap";
  const changes = instances.flatMap((i) => [i.startBeat, i.startBeat + i.beats]).filter((b) => b > songBeat);
  const length = songBeats(project);
  const next = Math.min(...changes, length); // the song's own end (the loop point) is a change too
  const left = Math.round(((next - songBeat) / bpb) * 10) / 10;
  return `${names} · bar ${Math.floor(songBeat / bpb) + 1} · change in ${left} ${left === 1 ? "bar" : "bars"}`;
}

/** Where the existing automation of `target` (a track or the master) plays in the song, as spans in beats from the song
 * start, for the Composer to draw it over: the sequences it applies to (see automationAppliesTo), left to right. Where two
 * of them overlap (parallel lanes) only the first is drawn; the lane is one shared piece of data either way. */
export function automationSpans(project: Project, target: "master" | TrackId): { startBeat: number; beats: number }[] {
  const instances = songInstances(project);
  const masterLane = masterLaneIndex(instances);
  const spans: { startBeat: number; beats: number }[] = [];
  let end = -Infinity;
  for (const i of instances) {
    if (!automationAppliesTo(i, target, masterLane) || i.startBeat < end) continue;
    spans.push({ startBeat: i.startBeat, beats: i.beats });
    end = i.startBeat + i.beats;
  }
  return spans;
}
