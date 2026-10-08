import type { ChainEntry, ChainEntryId, Pattern, PatternId } from "../model/types";

interface Props {
  patternChain: ChainEntry[];
  patterns: Pattern[];
  playingChainEntryId: ChainEntryId | null;
  onRemoveEntry: (entryId: ChainEntryId) => void;
}

/** Right column of the Patterns view: the queue (project.patternChain — see its doc comment)
 * in actual play order, one row per entry (not deduped by pattern, so a repeat like `[A, A, B]`
 * shows as two distinct A rows) — this is the one place order and queue membership are both
 * visible at once, which the old single-row chip launcher couldn't show once more than one
 * pattern was queued. Each row's own explicit "Remove" button targets exactly that entry
 * (model/project.ts's removeChainEntry), never every occurrence of its pattern, and never the
 * pattern itself -- removing a pattern from rotation here can never delete it (that's
 * PatternList's job, a clearly separate, clearly labeled action). Removal is refused by the
 * model whenever it would leave the queue empty; the button is disabled in that case (the only
 * remaining entry) rather than silently no-opping on click. */
export function PatternQueue({ patternChain, patterns, playingChainEntryId, onRemoveEntry }: Props) {
  const nameFor = (patternId: PatternId) => patterns.find((p) => p.id === patternId)?.name ?? "?";

  return (
    <div className="pattern-queue-column">
      <div className="pattern-list-header">
        <span className="pattern-bar-label">Queue</span>
      </div>
      <div className="pattern-queue">
        {patternChain.map((entry, i) => {
          const playing = entry.id === playingChainEntryId;
          return (
            <div key={entry.id} className={`queue-row ${playing ? "playing" : ""}`}>
              <span className="queue-row-position">{i + 1}</span>
              <span className="queue-row-name">{nameFor(entry.patternId)}</span>
              <button
                className="btn small danger"
                onClick={() => onRemoveEntry(entry.id)}
                disabled={patternChain.length <= 1}
                title={patternChain.length <= 1 ? "The queue needs at least one entry" : "Remove from queue"}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
