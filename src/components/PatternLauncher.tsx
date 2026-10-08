import type { Pattern, PatternId } from "../model/types";

interface Props {
  patterns: Pattern[];
  playingPatternId: PatternId | null;
  queuedPatternId: PatternId | null;
  onRequestLaunch: (id: PatternId) => void;
  onCancelLaunch: () => void;
}

/** Small, dedicated pattern-launching area (ECS-120) — separate from PatternBar's editing
 * concerns (select/create/duplicate/rename/bars) and from ChainEditor's predefined chain, per
 * ECS-115's "separate pattern editing from pattern launching" direction: the editor stays
 * focused on pattern contents, and this is the "own interaction/view layer" launching gets
 * instead. Owns the manual-launch interaction entirely — every chip here *is* its own
 * launch/cancel toggle (no separate select step, unlike PatternBar's chips) — using the same
 * shared Transport.requestPatternLaunch()/cancelQueuedLaunch() contract as everything else
 * (ECS-117); no transition logic lives here, just the UI that triggers it. Clicking the
 * already-playing pattern is left enabled rather than special-cased away: the contract already
 * treats "request the pattern that's already playing" as cancelling any pending request, so
 * that click is still meaningful whenever something else is queued. */
export function PatternLauncher({ patterns, playingPatternId, queuedPatternId, onRequestLaunch, onCancelLaunch }: Props) {
  return (
    <div className="pattern-bar launcher-bar">
      <span className="pattern-bar-label">Launch</span>
      <div className="pattern-chips">
        {patterns.map((p) => {
          const playing = p.id === playingPatternId;
          const queued = p.id === queuedPatternId;
          return (
            <button
              key={p.id}
              className={`launcher-chip ${playing ? "playing" : ""} ${queued ? "queued" : ""}`}
              onClick={() => (queued ? onCancelLaunch() : onRequestLaunch(p.id))}
              title={queued ? "Cancel queued launch" : playing ? "Playing" : "Queue to launch at the next completion boundary"}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
