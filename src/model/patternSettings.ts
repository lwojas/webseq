// Per-pattern arp and Track LFO. A track has one arp and one Track LFO (Track.arp, Track.eventLfo); a pattern may carry its own
// for any track (Pattern.trackSettings), and where it does, THAT is what plays in this pattern and the track's own is left alone.
// A pattern with no entry for a track plays the track's settings, so projects saved before this exist play exactly as before.
// The first edit of a pattern's arp or LFO starts from what plays now (the pattern's own, else the track's) and stores it on the pattern.
import { arpOf, patchArp, type ArpVelocity, type TrackArp } from "./arp";
import { eventLfoOf, patchEventLfo } from "./eventLfo";
import { updatePattern } from "./project";
import type { Pattern, PatternId, PatternTrackSettings, Project, Track, TrackEventLfo, TrackId } from "./types";

type ArpPatch = Partial<Omit<TrackArp, "velocity">> & { velocity?: Partial<ArpVelocity> };

/** True when `pattern` has its own arp or Track LFO for `trackId`. */
export function hasPatternSettings(pattern: Pattern | undefined, trackId: TrackId): boolean {
  return pattern?.trackSettings?.[trackId] !== undefined;
}

/** `track` as it plays in `pattern`: its arp / Track LFO replaced by the pattern's own where it has them. The same object when it has none. */
export function trackInPattern(track: Track, pattern: Pattern): Track {
  const own = pattern.trackSettings?.[track.id];
  const automation = pattern.automation?.[track.id];
  if (!own && !automation) return track;
  return { ...track, ...(own?.arp ? { arp: own.arp } : {}), ...(own?.eventLfo ? { eventLfo: own.eventLfo } : {}), ...(automation ? { automation } : {}) };
}

function withSettings(project: Project, patternId: PatternId, trackId: TrackId, update: (own: PatternTrackSettings, track: Track) => PatternTrackSettings): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return project;
  return updatePattern(project, patternId, (p) => ({ ...p, trackSettings: { ...p.trackSettings, [trackId]: update(p.trackSettings?.[trackId] ?? {}, trackInPattern(track, p)) } }));
}

/** Edits the arp this pattern plays on `trackId`. The track's own arp is not touched. */
export function setPatternArp(project: Project, patternId: PatternId, trackId: TrackId, patch: ArpPatch): Project {
  return withSettings(project, patternId, trackId, (own, played) => ({ ...own, arp: patchArp(arpOf(played), patch) }));
}

/** Edits the Track LFO this pattern plays on `trackId`. The track's own is not touched. */
export function setPatternEventLfo(project: Project, patternId: PatternId, trackId: TrackId, patch: Partial<TrackEventLfo>): Project {
  return withSettings(project, patternId, trackId, (own, played) => ({ ...own, eventLfo: patchEventLfo(eventLfoOf(played), patch) }));
}

/** Drops the pattern's own arp and Track LFO for `trackId`: it plays the track's again. */
export function clearPatternSettings(project: Project, patternId: PatternId, trackId: TrackId): Project {
  return updatePattern(project, patternId, (p) => {
    if (!p.trackSettings?.[trackId]) return p;
    const { [trackId]: _gone, ...rest } = p.trackSettings;
    const { trackSettings: _old, ...pattern } = p;
    return Object.keys(rest).length > 0 ? { ...pattern, trackSettings: rest } : pattern;
  });
}
