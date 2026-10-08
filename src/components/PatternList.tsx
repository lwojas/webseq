import type { Pattern, PatternId } from "../model/types";

interface Props {
  patterns: Pattern[];
  selectedPatternId: PatternId;
  playingPatternId: PatternId | null;
  onSelect: (id: PatternId) => void;
  onAdd: () => void;
  onDuplicate: (id: PatternId) => void;
  onRemove: (id: PatternId) => void;
  onRename: (id: PatternId, name: string) => void;
  onSetBars: (id: PatternId, bars: number) => void;
  onQueueNext: (id: PatternId) => void;
}

/** Left column of the Patterns view: the pattern library (create/duplicate/rename/delete),
 * scaling to dozens of patterns as a vertical list rather than PatternBar's horizontal,
 * wrapping chip row. Selecting a row sets `selectedPatternId` (same editing selection
 * PatternBar drives) so switching to the Sequencer view shows it already selected. "Queue →"
 * is the only queue-facing action here -- it never needs to know current queue membership
 * (always allowed, even for the playing pattern: queuing a repeat is a legitimate explicit
 * choice under the ordered-queue model), since PatternQueue is the one place that shows/edits
 * what's actually queued. */
export function PatternList({
  patterns,
  selectedPatternId,
  playingPatternId,
  onSelect,
  onAdd,
  onDuplicate,
  onRemove,
  onRename,
  onSetBars,
  onQueueNext,
}: Props) {
  return (
    <div className="pattern-list-column">
      <div className="pattern-list-header">
        <span className="pattern-bar-label">Patterns</span>
        <button className="btn small" onClick={onAdd}>
          + Pattern
        </button>
      </div>
      <div className="pattern-list">
        {patterns.map((p) => {
          const selected = p.id === selectedPatternId;
          const playing = p.id === playingPatternId;
          return (
            <div key={p.id} className={`pattern-list-row ${selected ? "active" : ""} ${playing ? "playing" : ""}`} onClick={() => onSelect(p.id)}>
              <input
                className="pattern-name-input"
                value={p.name}
                onChange={(e) => onRename(p.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="field pattern-list-bars">
                <span>Bars</span>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={p.bars}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onSetBars(p.id, Number(e.target.value))}
                />
              </div>
              <div className="pattern-list-row-actions">
                <button
                  className="btn small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onQueueNext(p.id);
                  }}
                  title="Queue to play next"
                >
                  Queue →
                </button>
                <button
                  className="btn small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(p.id);
                  }}
                >
                  Duplicate
                </button>
                <button
                  className="btn small danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(p.id);
                  }}
                  disabled={patterns.length <= 1}
                  title={patterns.length <= 1 ? "A project needs at least one pattern" : "Delete this pattern"}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
