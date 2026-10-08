import type { Pattern, PatternId } from "../model/types";

interface Props {
  patterns: Pattern[];
  selectedPatternId: PatternId;
  onSelectPattern: (id: PatternId) => void;
  onAddPattern: () => void;
  onDuplicatePattern: (id: PatternId) => void;
  onRemovePattern: (id: PatternId) => void;
  onRenamePattern: (id: PatternId, name: string) => void;
  onSetBars: (id: PatternId, bars: number) => void;
  /** The pattern currently sounding, or null while stopped/paused (ECS-117) — independent of
   * `selectedPatternId`, which is only the editing selection. */
  playingPatternId?: PatternId | null;
  /** The pending manual-launch request, or null if none (ECS-117) — see Transport's launch
   * contract module comment for exactly when this is set/cleared. */
  queuedPatternId?: PatternId | null;
  /** Queues `id` to take over at the current pattern's next completion boundary, using
   * Transport's manual-launch contract (ECS-117) — replaces any previously queued pattern. */
  onRequestLaunch: (id: PatternId) => void;
  /** Cancels a pending queued launch, if any. */
  onCancelLaunch: () => void;
}

/** Pattern selector + editor: which pattern is currently open in the timeline below, plus
 * create/duplicate/remove/rename and the pattern's own bar count. Playback of the pattern
 * *chain* is independent of this selection — see ChainEditor and Transport's doc comments —
 * this only controls what you're looking at/editing. Each chip also exposes the manual-launch
 * control from the shared Transport contract (ECS-117/ECS-119): a dedicated toggling button
 * (queue / cancel), never the chip's own select click, so picking a pattern to look at never
 * launches it (and vice versa). */
export function PatternBar({
  patterns,
  selectedPatternId,
  onSelectPattern,
  onAddPattern,
  onDuplicatePattern,
  onRemovePattern,
  onRenamePattern,
  onSetBars,
  playingPatternId = null,
  queuedPatternId = null,
  onRequestLaunch,
  onCancelLaunch,
}: Props) {
  const selected = patterns.find((p) => p.id === selectedPatternId);

  return (
    <div className="pattern-bar">
      <span className="pattern-bar-label">Patterns</span>
      <div className="pattern-chips">
        {patterns.map((p) => (
          <div
            key={p.id}
            className={`pattern-chip ${p.id === selectedPatternId ? "active" : ""} ${p.id === playingPatternId ? "playing" : ""} ${p.id === queuedPatternId ? "queued" : ""}`}
          >
            <button
              className="pattern-chip-name"
              onClick={() => onSelectPattern(p.id)}
              title={`${p.bars} bar${p.bars > 1 ? "s" : ""}${p.id === queuedPatternId ? " · queued" : ""}`}
            >
              {p.name}
            </button>
            {p.id !== playingPatternId && (
              <button
                className={`pattern-chip-launch ${p.id === queuedPatternId ? "active" : ""}`}
                onClick={() => (p.id === queuedPatternId ? onCancelLaunch() : onRequestLaunch(p.id))}
                title={p.id === queuedPatternId ? "Cancel queued launch" : "Queue to launch at the next completion boundary"}
                aria-label={p.id === queuedPatternId ? `Cancel queued launch of ${p.name}` : `Queue ${p.name} to launch`}
              >
                {p.id === queuedPatternId ? "×" : "▶"}
              </button>
            )}
          </div>
        ))}
        <button className="btn small" onClick={onAddPattern}>
          + Pattern
        </button>
      </div>

      {selected && (
        <div className="pattern-edit-fields">
          <input
            className="pattern-name-input"
            value={selected.name}
            onChange={(e) => onRenamePattern(selected.id, e.target.value)}
          />
          <div className="field">
            <span>Bars</span>
            <input
              type="number"
              min={1}
              max={64}
              value={selected.bars}
              onChange={(e) => onSetBars(selected.id, Number(e.target.value))}
            />
          </div>
          <button className="btn small" onClick={() => onDuplicatePattern(selected.id)}>
            Duplicate
          </button>
          <button
            className="btn small danger"
            onClick={() => onRemovePattern(selected.id)}
            disabled={patterns.length <= 1}
            title={patterns.length <= 1 ? "A project needs at least one pattern" : "Remove this pattern"}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
