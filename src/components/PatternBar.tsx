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
   * `selectedPatternId`, which is only the editing selection. Purely a visualization of
   * Transport's own state; this component has no launch controls of its own yet. */
  playingPatternId?: PatternId | null;
  /** The pending manual-launch request, or null if none (ECS-117) — see Transport's launch
   * contract module comment for exactly when this is set/cleared. */
  queuedPatternId?: PatternId | null;
}

/** Pattern selector + editor: which pattern is currently open in the timeline below, plus
 * create/duplicate/remove/rename and the pattern's own bar count. Playback of the pattern
 * *chain* is independent of this selection — see ChainEditor and Transport's doc comments —
 * this only controls what you're looking at/editing. `playingPatternId`/`queuedPatternId` are
 * shown here too (not just in ChainEditor) because a manual launch works for any pattern,
 * chained or not (ECS-117) — visualization only; queuing/cancelling a launch from this bar is
 * for a later pattern-launcher ticket (ECS-118/ECS-120). */
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
}: Props) {
  const selected = patterns.find((p) => p.id === selectedPatternId);

  return (
    <div className="pattern-bar">
      <span className="pattern-bar-label">Patterns</span>
      <div className="pattern-chips">
        {patterns.map((p) => (
          <button
            key={p.id}
            className={`pattern-chip ${p.id === selectedPatternId ? "active" : ""} ${p.id === playingPatternId ? "playing" : ""} ${p.id === queuedPatternId ? "queued" : ""}`}
            onClick={() => onSelectPattern(p.id)}
            title={`${p.bars} bar${p.bars > 1 ? "s" : ""}${p.id === queuedPatternId ? " · queued" : ""}`}
          >
            {p.name}
          </button>
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
