import type { ChainEntry, Pattern, PatternId } from "../model/types";

interface Props {
  patterns: Pattern[];
  /** The pattern queue (project.patternChain — see its doc comment): an ordered, circular,
   * never-empty playlist. A pattern's membership here (not a single scalar "queued" id) is
   * what this component visualizes and edits. */
  patternChain: ChainEntry[];
  playingPatternId: PatternId | null;
  /** Queues `id` right after whatever's currently playing (model/project.ts's
   * queuePatternNext) — the caller resolves "currently playing" via
   * Transport.getCurrentChainEntryId(), since the queue itself has no playback-position
   * concept of its own. */
  onQueueNext: (patternId: PatternId) => void;
  /** Removes every queue entry for `id` (model/project.ts's removePatternFromQueue) — refused
   * by the model if that would leave the queue empty. */
  onRemoveFromQueue: (patternId: PatternId) => void;
}

/** Small, dedicated pattern-launching area — separate from PatternBar's editing concerns
 * (select/create/duplicate/rename/bars), per ECS-115's "separate pattern editing from pattern
 * launching" direction. The pattern queue *is* the playback driver (there's no separate
 * predefined chain any more — see Project.patternChain's doc comment): queuing a pattern here
 * inserts it into the loop right after whatever's currently playing, and it stays there,
 * repeating, until explicitly removed — never a one-shot override that falls back to some
 * other sequence on its own. Every chip is its own queue/remove toggle (no separate select
 * step, unlike PatternBar's chips), using the project reducer directly (queuing is an ordinary
 * project edit, not transient playback state) rather than any transport-side launch API. */
export function PatternLauncher({ patterns, patternChain, playingPatternId, onQueueNext, onRemoveFromQueue }: Props) {
  return (
    <div className="pattern-bar launcher-bar">
      <span className="pattern-bar-label">Launch</span>
      <div className="pattern-chips">
        {patterns.map((p) => {
          const playing = p.id === playingPatternId;
          const queued = !playing && patternChain.some((e) => e.patternId === p.id);
          return (
            <button
              key={p.id}
              className={`launcher-chip ${playing ? "playing" : ""} ${queued ? "queued" : ""}`}
              onClick={() => (queued ? onRemoveFromQueue(p.id) : onQueueNext(p.id))}
              disabled={playing}
              title={queued ? "Remove from queue" : playing ? "Playing" : "Queue next"}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
