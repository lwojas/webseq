import type { ChainEntry, ChainEntryId, Pattern, PatternId } from "../model/types";
import { RafText } from "./RafText";

interface Props {
  patternChain: ChainEntry[];
  patterns: Pattern[];
  playingChainEntryId: ChainEntryId | null;
  onRemoveEntry: (entryId: ChainEntryId) => void;
  /** Move an entry to a new position in the queue. Playback stays continuous (App.tsx shifts the
   * transport's step counter with it — see Transport.shiftChainSteps). */
  onMoveEntry: (entryId: ChainEntryId, toIndex: number) => void;
  /** "bar 2 / 4" for the playing pattern, read per frame (see RafText). */
  getPlayingBarText: () => string;
}

/** Right column of the Patterns page: the queue (project.patternChain — see its doc comment) in
 * actual play order, one row per entry (not deduped by pattern, so a repeat like `[A, A, B]` shows
 * as two distinct A rows) — this is the one place order and queue membership are both visible at
 * once. The sounding entry says "now" (with its bar), the one after it "next". ▲ ▼ reorder; each
 * row's own explicit "Remove" targets exactly that entry (model/project.ts's removeChainEntry),
 * never every occurrence of its pattern, and never the pattern itself -- removing a pattern from
 * rotation here can never delete it. Removal is refused by the model whenever it would leave the
 * queue empty; the button is disabled in that case (the only remaining entry). */
export function PatternQueue({ patternChain, patterns, playingChainEntryId, onRemoveEntry, onMoveEntry, getPlayingBarText }: Props) {
  const nameFor = (patternId: PatternId) => patterns.find((p) => p.id === patternId)?.name ?? "?";
  const playingIndex = patternChain.findIndex((e) => e.id === playingChainEntryId);
  const nextIndex = playingIndex === -1 || patternChain.length < 2 ? -1 : (playingIndex + 1) % patternChain.length;

  return (
    <div className="pattern-queue-column">
      <div className="pattern-list-header">
        <span className="pattern-bar-label">Queue · plays top to bottom, then loops</span>
      </div>
      <div className="pattern-queue">
        {patternChain.map((entry, i) => {
          const playing = i === playingIndex;
          return (
            <div key={entry.id} className={`queue-row ${playing ? "playing" : ""}`}>
              <span className="queue-row-position">{i + 1}</span>
              <span className="queue-row-name">{nameFor(entry.patternId)}</span>
              {playing && (
                <span className="queue-row-tag playing">
                  now · <RafText getText={getPlayingBarText} />
                </span>
              )}
              {i === nextIndex && <span className="queue-row-tag next">next</span>}
              <span className="queue-row-actions">
                <button
                  className="btn small"
                  onClick={() => onMoveEntry(entry.id, i - 1)}
                  disabled={i === 0}
                  aria-label={`Move ${nameFor(entry.patternId)} up`}
                  title="Play earlier"
                >
                  ▲
                </button>
                <button
                  className="btn small"
                  onClick={() => onMoveEntry(entry.id, i + 1)}
                  disabled={i === patternChain.length - 1}
                  aria-label={`Move ${nameFor(entry.patternId)} down`}
                  title="Play later"
                >
                  ▼
                </button>
                <button
                  className="btn small danger"
                  onClick={() => onRemoveEntry(entry.id)}
                  disabled={patternChain.length <= 1}
                  title={patternChain.length <= 1 ? "The queue needs at least one entry" : "Remove from queue"}
                >
                  Remove
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
