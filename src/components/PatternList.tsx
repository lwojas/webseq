import { useEffect, useState } from "react";
import type { Pattern, PatternId } from "../model/types";
import { BarsStepper } from "./PatternStrip";

interface Props {
  patterns: Pattern[];
  /** The pattern open in the timeline. */
  selectedPatternId: PatternId;
  playingPatternId: PatternId | null;
  onSelect: (id: PatternId) => void;
  /** Select the pattern AND return to the sequencer with it open. */
  onEdit: (id: PatternId) => void;
  onDuplicate: (id: PatternId) => void;
  onRemove: (id: PatternId) => void;
  onRename: (id: PatternId, name: string) => void;
  onSetBars: (id: PatternId, bars: number) => void;
  onQueueNext: (id: PatternId) => void;
  /** Copy this pattern onto the Composer timeline as a new, independent sequence. */
  onAddToComposer: (id: PatternId) => void;
}

/** How many distinct tracks have at least one step in `pattern`. */
function tracksUsed(pattern: Pattern): number {
  return new Set(Object.values(pattern.notes).map((n) => n.trackId)).size;
}

interface RowProps {
  pattern: Pattern;
  editing: boolean;
  playing: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
  onSetBars: (bars: number) => void;
  onQueueNext: () => void;
  onAddToComposer: () => void;
}

/** One pattern. Status is in words (EDITING / ▶ PLAYING), the everyday actions are visible
 * (Edit ▸, Queue →, Duplicate) and the rare / destructive ones (Rename, Delete) are in ⋯. This view
 * isn't over the timeline, so a small menu here costs nothing in the hot loop. */
function PatternRow({ pattern, editing, playing, canDelete, onSelect, onEdit, onDuplicate, onRemove, onRename, onSetBars, onQueueNext, onAddToComposer }: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // Closes on any press outside the menu (menu items stop propagation themselves).
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const stop = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fn();
  };
  const used = tracksUsed(pattern);

  return (
    <div className={`pattern-list-row ${editing ? "active" : ""} ${playing ? "playing" : ""}`} onClick={onSelect}>
      <span className="pattern-list-tags">
        {editing && <span className="status-tag editing">Editing</span>}
        {playing && <span className="status-tag playing">▶ Playing</span>}
      </span>
      {renaming ? (
        <input
          className="pattern-name-input pattern-list-name"
          value={pattern.name}
          autoFocus
          aria-label="Pattern name"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onRename(e.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && setRenaming(false)}
        />
      ) : (
        <span className={`pattern-list-name-text ${editing || playing ? "strong" : ""}`}>{pattern.name}</span>
      )}
      <span className="pattern-list-meta">
        {used} track{used === 1 ? "" : "s"} used
      </span>
      <div className="pattern-list-bars" onClick={(e) => e.stopPropagation()}>
        <BarsStepper bars={pattern.bars} onSetBars={onSetBars} />
      </div>
      <div className="pattern-list-row-actions">
        <button className="btn small pattern-edit-btn" onClick={stop(onEdit)} title="Open this pattern in the sequencer">
          Edit ▸
        </button>
        <button className="btn small" onClick={stop(onQueueNext)} title="Queue to play next">
          Queue →
        </button>
        <button className="btn small" onClick={stop(onAddToComposer)} title="Add a copy to the Composer timeline">
          + Composer
        </button>
        <button className="btn small" onClick={stop(onDuplicate)}>
          Duplicate
        </button>
        <div className="row-menu-wrap">
          <button
            className="btn small"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`More actions for ${pattern.name}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={stop(() => setMenuOpen((o) => !o))}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="row-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
              <button
                role="menuitem"
                onClick={stop(() => {
                  setMenuOpen(false);
                  setRenaming(true);
                })}
              >
                Rename…
              </button>
              <button
                role="menuitem"
                className="danger"
                disabled={!canDelete}
                title={canDelete ? "Delete this pattern" : "A project needs at least one pattern"}
                onClick={stop(() => {
                  setMenuOpen(false);
                  onRemove();
                })}
              >
                Delete pattern
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Left column of the Patterns page: the pattern library. Selecting a row sets `selectedPatternId`
 * (the pattern the sequencer edits); "Edit ▸" also returns to the sequencer. "Queue →" is the only
 * queue-facing action here — it never needs to know current queue membership (always allowed, even
 * for the playing pattern: queuing a repeat is a legitimate explicit choice under the ordered-queue
 * model), since PatternQueue is the one place that shows and edits what's queued. */
export function PatternList({ patterns, selectedPatternId, playingPatternId, onSelect, onEdit, onDuplicate, onRemove, onRename, onSetBars, onQueueNext, onAddToComposer }: Props) {
  return (
    <div className="pattern-list-column">
      <div className="pattern-list-header">
        <span className="pattern-bar-label">Patterns</span>
      </div>
      <div className="pattern-list">
        {patterns.map((p) => (
          <PatternRow
            key={p.id}
            pattern={p}
            editing={p.id === selectedPatternId}
            playing={p.id === playingPatternId}
            canDelete={patterns.length > 1}
            onSelect={() => onSelect(p.id)}
            onEdit={() => onEdit(p.id)}
            onDuplicate={() => onDuplicate(p.id)}
            onRemove={() => onRemove(p.id)}
            onRename={(name) => onRename(p.id, name)}
            onSetBars={(bars) => onSetBars(p.id, bars)}
            onQueueNext={() => onQueueNext(p.id)}
            onAddToComposer={() => onAddToComposer(p.id)}
          />
        ))}
      </div>
    </div>
  );
}
