import type { Pattern, PatternId } from "../model/types";
import { BarsStepper } from "./PatternStrip";

interface Props {
  patterns: Pattern[];
  selectedPatternId: PatternId;
  playingPatternId: PatternId | null;
  /** Select this pattern AND close the picker. */
  onPick: (id: PatternId) => void;
  onAddPattern: () => void;
  onDuplicate: (id: PatternId) => void;
  onRemove: (id: PatternId) => void;
  onRename: (id: PatternId, name: string) => void;
  onSetBars: (id: PatternId, bars: number) => void;
}

/** The pattern list, shown INSTEAD of the timeline (App.tsx hides the grid and dock while this is
 * mounted — it is a view, not an overlay, so nothing over the playhead needs repainting). Mounted
 * only while open, so its chips cost nothing the rest of the time. The list scrolls inside its own
 * fixed region; the footer with the rare/destructive actions stays pinned. */
export function PatternPicker({ patterns, selectedPatternId, playingPatternId, onPick, onAddPattern, onDuplicate, onRemove, onRename, onSetBars }: Props) {
  const selected = patterns.find((p) => p.id === selectedPatternId) ?? patterns[0];

  return (
    <div className="pattern-picker">
      <div className="pattern-picker-title">
        Patterns <span className="pattern-picker-count">{patterns.length}</span>
      </div>
      <div className="pattern-picker-list">
        {patterns.map((p) => (
          <button
            key={p.id}
            className={`pattern-picker-chip ${p.id === selected?.id ? "active" : ""} ${p.id === playingPatternId ? "playing" : ""}`}
            onClick={() => onPick(p.id)}
          >
            <span className="pattern-picker-chip-name">{p.name}</span>
            <span className="pattern-picker-chip-meta">
              {p.bars} bar{p.bars > 1 ? "s" : ""}
              {p.id === playingPatternId ? " · ▶" : ""}
            </span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="pattern-picker-footer">
          <input
            className="pattern-name-input"
            value={selected.name}
            aria-label="Rename pattern"
            onChange={(e) => onRename(selected.id, e.target.value)}
          />
          <BarsStepper bars={selected.bars} onSetBars={(bars) => onSetBars(selected.id, bars)} />
          <button className="btn small" onClick={onAddPattern}>
            + New
          </button>
          <button className="btn small" onClick={() => onDuplicate(selected.id)}>
            Duplicate
          </button>
          <button
            className="btn small danger"
            onClick={() => onRemove(selected.id)}
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
