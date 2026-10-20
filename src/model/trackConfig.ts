// Reusable track-configuration copy/paste (ECS-124), built on ECS-112's clipboard contract:
// a pure extractor (copyTrackConfig) and a pure, validating placer (pasteTrackConfig), the
// same copy-now/paste-later split notes.ts's CopiedNote/pasteNotes already uses. No React, no
// webdsp — usable from the reducer, App.tsx's handlers, or a test without modification.

import type { Asset, AssetId, AutomationLane, FxId, FxInstance, PlaybackMode, Project, Track, TrackEventLfo, TrackId, TrackInstrument, VoiceMode } from "./types";
import { INSTRUMENT_DEFS } from "./instruments";
import type { TrackArp } from "./arp";
import { DEFAULT_PLAYBACK_MODE, DEFAULT_VOICE_MODE, effectivePan, effectivePlaybackMode, effectiveVoiceMode } from "./types";

/** By-value copy of a synth source, including its LFO slots. */
export function cloneInstrument(i: TrackInstrument): TrackInstrument {
  const copy: TrackInstrument = { ...i, params: { ...i.params } };
  if (i.lfos) copy.lfos = i.lfos.map((l) => ({ ...l }));
  return copy;
}

function cloneArp(a: TrackArp): TrackArp {
  return { ...a, velocity: { ...a.velocity, steps: [...a.velocity.steps] } };
}

/** The reusable-configuration boundary (ECS-124's field-by-field decision): asset reference,
 * FX chain, automation, and playback/voice mode. Never id/name (destination identity) or
 * volume/muted/soloed (mixer/performance state) — those are excluded by the ticket and never
 * appear here, so there's no field to accidentally carry across. */
export interface CopiedTrackConfig {
  assetId: AssetId | null;
  fx: FxInstance[];
  automation: AutomationLane[];
  playbackMode?: PlaybackMode;
  voiceMode?: VoiceMode;
  /** The synth source, if the track plays one (mutually exclusive with `assetId`). */
  instrument?: TrackInstrument | null;
  pan?: number;
  /** The track's event LFO (by value). */
  eventLfo?: TrackEventLfo;
  /** The track's arpeggiator (by value). */
  arp?: TrackArp;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Deep-clones an FX chain with fresh FX ids, remapping the automation lanes to them (lanes whose
 * FX isn't in the chain are dropped). Two tracks must never reference the same FxInstance. */
export function cloneFxChain(
  fx: FxInstance[],
  automation: AutomationLane[],
): { fx: FxInstance[]; automation: AutomationLane[] } {
  const idMap = new Map<FxId, FxId>();
  const newFx = fx.map((f) => {
    const id = nextId("fx");
    idMap.set(f.id, id);
    return { ...f, id, params: { ...f.params }, ...(f.lfos ? { lfos: f.lfos.map((l) => ({ ...l })) } : {}) };
  });
  // Lanes with no fxId automate the track's source, not an FX, so they carry over unchanged.
  const newAutomation = automation
    .filter((lane) => lane.fxId == null || idMap.has(lane.fxId))
    .map((lane) => ({ ...lane, ...(lane.fxId != null ? { fxId: idMap.get(lane.fxId)! } : {}), events: lane.events.map((e) => ({ ...e })) }));
  return { fx: newFx, automation: newAutomation };
}

/** Whether `track` has any reusable configuration worth copying — same "nothing to do, hide
 * the button" convention notes.ts's clearTrackNotes already applies (see its own doc comment)
 * and App.tsx's hasNotes/selectedTrackHasNotes already follow for Copy/Clear sequence.
 *
 * Compares playbackMode/voiceMode against their *effective* default rather than checking
 * `!== undefined`: createInitialTracks (project.ts) already populates every newly-created
 * track with DEFAULT_PLAYBACK_MODE/DEFAULT_VOICE_MODE explicitly, so `undefined` only occurs
 * for a track from an older saved project (before these fields existed) — checking for
 * `undefined` would make this true for essentially every track, defeating the "only show when
 * there's actually something to copy" point of the check. */
export function hasTrackConfig(track: Track): boolean {
  return (
    track.assetId != null ||
    track.instrument != null ||
    effectivePan(track) !== 0 ||
    track.fx.length > 0 ||
    track.automation.length > 0 ||
    track.eventLfo?.enabled === true ||
    track.arp?.enabled === true ||
    effectivePlaybackMode(track) !== DEFAULT_PLAYBACK_MODE ||
    effectiveVoiceMode(track) !== DEFAULT_VOICE_MODE
  );
}

/** Snapshots the reusable-configuration fields only. FX/automation are deep-cloned (fresh
 * arrays, fresh param/event objects) so the clipboard can never share a mutable structure with
 * the live project — editing the source track after copying must never retroactively change
 * what gets pasted. */
export function copyTrackConfig(track: Track): CopiedTrackConfig {
  return {
    assetId: track.assetId,
    fx: track.fx.map((f) => ({ ...f, params: { ...f.params } })),
    automation: track.automation.map((a) => ({ ...a, events: a.events.map((e) => ({ ...e })) })),
    playbackMode: track.playbackMode,
    voiceMode: track.voiceMode,
    instrument: track.instrument ? cloneInstrument(track.instrument) : null,
    pan: track.pan,
    eventLfo: track.eventLfo ? { ...track.eventLfo } : undefined,
    arp: track.arp ? cloneArp(track.arp) : undefined,
  };
}

/** Pastes `config` onto `trackId`, replacing its reusable configuration atomically — never a
 * partial merge with whatever the destination already had. A merge isn't safe here: the audio
 * engine allows only one FX of a given type per chain (see fx.ts's addFx), so splicing copied
 * FX into an existing chain could easily produce a state the engine can't represent, and there
 * is no undo to recover from a bad merge. A whole-chain replace is the only result that's
 * always valid.
 *
 * Every copied FX gets a fresh id (regenerated here, not reused from the clipboard — two
 * tracks must never reference the same FxInstance); automation lanes are remapped to point at
 * those new ids so they stay valid against the chain that's actually written, never the
 * copied one. A stale assetId — removed from the project sometime between copy and paste —
 * falls back to null rather than leaving a dangling reference, the same outcome
 * project.ts's removeAsset already produces for any track that loses its asset. When a valid
 * asset *is* assigned, the destination's name is updated to match, mirroring assignAsset's own
 * rule; when assetId is null, name is left untouched, mirroring removeAsset's own rule (an
 * unassigned track's name is simply never shown — see TrackRow/MixerPanel). Destination id,
 * volume, muted and soloed are never touched. */
export function pasteTrackConfig(project: Project, trackId: TrackId, config: CopiedTrackConfig): Project {
  const asset: Asset | undefined = config.assetId != null ? project.assets.find((a) => a.id === config.assetId) : undefined;
  const assetId: AssetId | null = asset ? asset.id : null;
  const instrument: TrackInstrument | null = config.instrument ? cloneInstrument(config.instrument) : null;

  const { fx, automation } = cloneFxChain(config.fx, config.automation);

  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === trackId
        ? {
            ...t,
            assetId,
            instrument,
            pan: config.pan,
            eventLfo: config.eventLfo ? { ...config.eventLfo } : undefined,
            arp: config.arp ? cloneArp(config.arp) : undefined,
            name: asset ? asset.name : instrument ? (INSTRUMENT_DEFS[instrument.kind]?.label ?? t.name) : t.name,
            fx,
            automation,
            playbackMode: config.playbackMode,
            voiceMode: config.voiceMode,
          }
        : t,
    ),
  };
}
