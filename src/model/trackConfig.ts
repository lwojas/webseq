// Reusable track-configuration copy/paste (ECS-124), built on ECS-112's clipboard contract:
// a pure extractor (copyTrackConfig) and a pure, validating placer (pasteTrackConfig), the
// same copy-now/paste-later split notes.ts's CopiedNote/pasteNotes already uses. No React, no
// webdsp — usable from the reducer, App.tsx's handlers, or a test without modification.

import type { Asset, AssetId, AutomationLane, FxId, FxInstance, PlaybackMode, Project, Track, TrackId, VoiceMode } from "./types";
import { DEFAULT_PLAYBACK_MODE, DEFAULT_VOICE_MODE, effectivePlaybackMode, effectiveVoiceMode } from "./types";

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
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
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
    track.fx.length > 0 ||
    track.automation.length > 0 ||
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

  const idMap = new Map<FxId, FxId>();
  const fx: FxInstance[] = config.fx.map((f) => {
    const id = nextId("fx");
    idMap.set(f.id, id);
    return { ...f, id, params: { ...f.params } };
  });
  const automation: AutomationLane[] = config.automation
    .filter((lane) => idMap.has(lane.fxId))
    .map((lane) => ({ ...lane, fxId: idMap.get(lane.fxId)!, events: lane.events.map((e) => ({ ...e })) }));

  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === trackId
        ? {
            ...t,
            assetId,
            name: asset ? asset.name : t.name,
            fx,
            automation,
            playbackMode: config.playbackMode,
            voiceMode: config.voiceMode,
          }
        : t,
    ),
  };
}
