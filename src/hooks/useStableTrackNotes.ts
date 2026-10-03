// Selects each track's notes out of `pattern`, keeping the same array reference across
// renders for any track whose notes didn't actually change (ECS-56). `pattern.notes` is a flat
// Record keyed by note id (see model/types.ts's doc comment on Pattern), so editing one note
// anywhere produces a new `pattern` object every time — without this cache, every TrackRow
// would see a "new" notes array on every edit regardless of which track it belongs to, and
// wrapping TrackRow in React.memo would do nothing: props would always look different. Note
// objects themselves are only ever replaced for the note actually touched (see
// model/notes.ts's addNote/resizeNote/moveNote), so comparing by element reference is exact,
// not approximate.
import { useMemo, useRef } from "react";
import type { Note, Pattern, Track, TrackId } from "../model/types";
import { notesForTrack } from "../model/types";

export function useStableTrackNotes(pattern: Pattern, tracks: Track[]): Map<TrackId, Note[]> {
  const cacheRef = useRef<Map<TrackId, Note[]>>(new Map());

  return useMemo(() => {
    const next = new Map<TrackId, Note[]>();
    for (const track of tracks) {
      const fresh = notesForTrack(pattern, track.id);
      const prev = cacheRef.current.get(track.id);
      const unchanged = prev !== undefined && prev.length === fresh.length && prev.every((note, i) => note === fresh[i]);
      next.set(track.id, unchanged ? prev! : fresh);
    }
    cacheRef.current = next;
    return next;
  }, [pattern, tracks]);
}
