import type { Pattern } from "../model/types";
import { RafText } from "./RafText";

interface Props {
  editing: Pattern | undefined;
  playing: Pattern | undefined;
  /** Go back to the sequencer with the pattern being edited open. */
  onEditSelected: () => void;
  onAdd: () => void;
  getPlayingBarText: () => string;
  /** Where "Edit … ▸" takes you: the Sequencer view on desktop, the Timeline tab on a phone. */
  backLabel: string;
}

/** The Patterns page's header band: says the two roles once, in words. EDITING is the pattern open
 * in the timeline; PLAYING is what the transport is sounding. They can differ. */
export function PatternsHeader({ editing, playing, onEditSelected, onAdd, getPlayingBarText, backLabel }: Props) {
  return (
    <div className="patterns-header">
      <span className="patterns-header-role editing">
        <span className="pattern-strip-label editing">Editing</span>
        <b>{editing?.name ?? "—"}</b>
      </span>
      <span className="patterns-header-role playing">
        <span className="pattern-strip-label playing">Playing</span>
        {playing ? (
          <b>
            ▶ {playing.name} <RafText className="pattern-strip-playing-bar" getText={getPlayingBarText} />
          </b>
        ) : (
          <span className="patterns-header-idle">stopped</span>
        )}
      </span>
      <span className="patterns-header-actions">
        <button className="btn small patterns-header-edit" onClick={onEditSelected} disabled={!editing}>
          Edit {editing?.name} ▸ <span className="patterns-header-back">({backLabel})</span>
        </button>
        <button className="btn small" onClick={onAdd}>
          + Pattern
        </button>
      </span>
    </div>
  );
}
