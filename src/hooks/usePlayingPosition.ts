// PatternBar/PatternList's chip highlighting, and PatternQueue's per-row highlighting, need
// the *playing* pattern and queue entry as real React state, not a value read fresh only at
// render time: since the pattern queue (see Project.patternChain's doc comment) now advances
// on its own, with nobody clicking anything, nothing would otherwise trigger a re-render when
// it crosses a boundary unattended -- the highlighting would silently go stale until some
// unrelated state change happened to re-render the app. Unlike usePlayheadAnimation (which
// redraws the playhead line every animation frame via direct DOM mutation specifically to
// avoid React re-renders), this highlighting only needs to catch up within about a lookahead
// window of a boundary, not frame-accurately, so this polls far more coarsely and only calls
// setState when either id actually changes.
//
// Both the playing pattern id and the playing *queue entry* id are resolved together from one
// poll: a pattern can appear more than once in the queue, so PatternQueue needs entry-level
// identity (Transport.getCurrentChainEntryId()) to highlight the exact row that's sounding,
// not every row for that pattern.
import { useEffect, useRef, useState } from "react";
import type { ChainEntryId, PatternId } from "../model/types";
import type { Transport } from "../audio/transport";

const POLL_INTERVAL_MS = 150; // matches Transport's own scheduling lookahead window

export interface PlayingPosition {
  patternId: PatternId | null;
  chainEntryId: ChainEntryId | null;
}

const NOTHING_PLAYING: PlayingPosition = { patternId: null, chainEntryId: null };

export function usePlayingPosition(transportRef: React.RefObject<Transport | null>, isPlaying: boolean): PlayingPosition {
  const [position, setPosition] = useState<PlayingPosition>(NOTHING_PLAYING);
  const lastRef = useRef<PlayingPosition>(NOTHING_PLAYING);

  useEffect(() => {
    if (!isPlaying) {
      lastRef.current = NOTHING_PLAYING;
      setPosition(NOTHING_PLAYING);
      return;
    }
    const sync = () => {
      const transport = transportRef.current;
      const next: PlayingPosition = {
        patternId: transport?.getPlayheadInfo().patternId ?? null,
        chainEntryId: transport?.getCurrentChainEntryId() ?? null,
      };
      const last = lastRef.current;
      if (next.patternId !== last.patternId || next.chainEntryId !== last.chainEntryId) {
        lastRef.current = next;
        setPosition(next);
      }
    };
    sync();
    const id = setInterval(sync, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [transportRef, isPlaying]);

  return position;
}
