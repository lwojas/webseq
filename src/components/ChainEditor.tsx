import type { ChainEntry, Pattern, PatternId } from "../model/types";

interface Props {
  chain: ChainEntry[];
  patterns: Pattern[];
  playingPatternId: PatternId | null;
  onAppend: (patternId: PatternId) => void;
  onRemoveEntry: (entryId: string) => void;
  onMoveEntry: (fromIndex: number, toIndex: number) => void;
  selectedPatternIdToAdd: PatternId;
}

/** The project's ordered, possibly-repeating pattern chain — e.g. A -> A -> B -> C -> A. Safe
 * to edit during playback: see Transport's doc comment for exactly what changing this does
 * and doesn't affect while the transport is running (already-scheduled audio is never
 * touched; only steps not yet scheduled pick up an edit here). */
export function ChainEditor({ chain, patterns, playingPatternId, onAppend, onRemoveEntry, onMoveEntry, selectedPatternIdToAdd }: Props) {
  const nameFor = (patternId: PatternId) => patterns.find((p) => p.id === patternId)?.name ?? "?";

  return (
    <div className="chain-editor">
      <span className="pattern-bar-label">Chain</span>
      <div className="chain-chips">
        {chain.length === 0 && <span className="chain-empty">empty — nothing will play</span>}
        {chain.map((entry, i) => (
          <div key={entry.id} className={`chain-chip ${entry.patternId === playingPatternId ? "playing" : ""}`}>
            <button className="chain-move" disabled={i === 0} onClick={() => onMoveEntry(i, i - 1)} title="Move earlier">
              ‹
            </button>
            <span className="chain-chip-name">{nameFor(entry.patternId)}</span>
            <button className="chain-move" disabled={i === chain.length - 1} onClick={() => onMoveEntry(i, i + 1)} title="Move later">
              ›
            </button>
            <button className="chain-remove" onClick={() => onRemoveEntry(entry.id)} title="Remove from chain">
              ×
            </button>
          </div>
        ))}
        <button className="btn small" onClick={() => onAppend(selectedPatternIdToAdd)}>
          + Add current pattern
        </button>
      </div>
    </div>
  );
}
