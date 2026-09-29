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
}

/** Pattern selector + editor: which pattern is currently open in the timeline below, plus
 * create/duplicate/remove/rename and the pattern's own bar count. Playback of the pattern
 * *chain* is independent of this selection — see ChainEditor and Transport's doc comments —
 * this only controls what you're looking at/editing. */
export function PatternBar({
  patterns,
  selectedPatternId,
  onSelectPattern,
  onAddPattern,
  onDuplicatePattern,
  onRemovePattern,
  onRenamePattern,
  onSetBars,
}: Props) {
  const selected = patterns.find((p) => p.id === selectedPatternId);

  return (
    <div className="pattern-bar">
      <span className="pattern-bar-label">Patterns</span>
      <div className="pattern-chips">
        {patterns.map((p) => (
          <button
            key={p.id}
            className={`pattern-chip ${p.id === selectedPatternId ? "active" : ""}`}
            onClick={() => onSelectPattern(p.id)}
            title={`${p.bars} bar${p.bars > 1 ? "s" : ""}`}
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
