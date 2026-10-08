// PatternBar/PatternLauncher's chip highlighting needs the *playing* pattern as real React
// state, not a value read fresh only at render time: since the pattern queue (see
// Project.patternChain's doc comment) now advances on its own, with nobody clicking anything,
// nothing would otherwise trigger a re-render when it crosses a boundary unattended -- the
// chip highlighting would silently go stale until some unrelated state change happened to
// re-render the app. Unlike usePlayheadAnimation (which redraws the playhead line every
// animation frame via direct DOM mutation specifically to avoid React re-renders), chip
// highlighting only needs to catch up within about a lookahead window of a boundary, not
// frame-accurately, so this polls far more coarsely and only calls setState when the pattern
// id actually changes.
import { useEffect, useRef, useState } from "react";
import type { PatternId } from "../model/types";
import type { Transport } from "../audio/transport";

const POLL_INTERVAL_MS = 150; // matches Transport's own scheduling lookahead window

export function usePlayingPatternId(transportRef: React.RefObject<Transport | null>, isPlaying: boolean): PatternId | null {
  const [patternId, setPatternId] = useState<PatternId | null>(null);
  const lastRef = useRef<PatternId | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      lastRef.current = null;
      setPatternId(null);
      return;
    }
    const sync = () => {
      const next = transportRef.current?.getPlayheadInfo().patternId ?? null;
      if (next !== lastRef.current) {
        lastRef.current = next;
        setPatternId(next);
      }
    };
    sync();
    const id = setInterval(sync, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [transportRef, isPlaying]);

  return patternId;
}
