/** One clipboard object kind (Track, Sequence, ...) as a Copy/Paste row. The panel renders
 * whatever rows it's given, so a new object kind is one more entry in App.tsx's list. */
export interface ClipboardRow {
  id: string;
  label: string;
  /** Why Copy is unavailable right now, or null when it is available. */
  copyBlocked: string | null;
  /** Why Paste is unavailable right now (e.g. nothing of this kind copied), or null. */
  pasteBlocked: string | null;
  /** What is on the clipboard for this kind, e.g. "Bank A / Track 03", or null when empty. */
  copied: string | null;
  onCopy: () => void;
  onPaste: () => void;
}

/** A one-shot action over the sequence's steps. */
export interface BarTool {
  id: string;
  label: string;
  /** Why it's unavailable right now, or null. Doubles as the tooltip when disabled. */
  blocked: string | null;
  /** Shown beside the button when available, e.g. which bar it will act on. */
  hint: string | null;
  onRun: () => void;
}

import { ComposerDetails, type ComposerDetailsProps } from "./ComposerDetails";

interface Props {
  history: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void };
  clipboard: ClipboardRow[];
  barTools: BarTool[];
  /** Transient result of the last action, cleared by App.tsx after a couple of seconds. */
  feedback: string | null;
  /** Present while the Composer view is up: the details of the selected sequence and lane (the Composer's own toolbar
   * has only the quick actions). */
  composer?: ComposerDetailsProps;
}

/** The Edit tab: project-level editing operations grouped by what they act on. Presentational —
 * all state and model calls live in App.tsx. */
export function EditPanel({ history, clipboard, barTools, feedback, composer }: Props) {
  return (
    <div className="edit-panel">
      {composer && <ComposerDetails {...composer} />}
      <section className="edit-group">
        <div className="edit-group-title">History</div>
        <div className="edit-row">
          <button className="track-copy-btn edit-history-btn" disabled={!history.canUndo} title={history.canUndo ? "Undo (Ctrl/⌘ Z)" : "Nothing to undo"} onClick={history.onUndo}>
            Undo
          </button>
          <button className="track-copy-btn edit-history-btn" disabled={!history.canRedo} title={history.canRedo ? "Redo (Shift+Ctrl/⌘ Z)" : "Nothing to redo"} onClick={history.onRedo}>
            Redo
          </button>
        </div>
      </section>
      {/* In the Composer the track clipboard and bar tools are not offered: they act on the selected track and pattern, which
          the Composer does not show, so nothing would confirm what they did. They return with the Sequencer. */}
      {!composer && (
        <>
      <section className="edit-group">
        <div className="edit-group-title">Clipboard</div>
        {clipboard.map((row) => (
          <div key={row.id} className="edit-row">
            <span className="edit-row-label">{row.label}</span>
            <button className="track-copy-btn" disabled={row.copyBlocked !== null} title={row.copyBlocked ?? `Copy ${row.label}`} onClick={row.onCopy}>
              Copy
            </button>
            <button className="track-paste-btn" disabled={row.pasteBlocked !== null} title={row.pasteBlocked ?? `Paste ${row.label}`} onClick={row.onPaste}>
              Paste
            </button>
            <span className="edit-row-status">{row.copied ?? ""}</span>
          </div>
        ))}
      </section>
      <section className="edit-group">
        <div className="edit-group-title">Bar Tools</div>
        {barTools.map((tool) => (
          <div key={tool.id} className="edit-row">
            <button className="track-copy-btn edit-tool-btn" disabled={tool.blocked !== null} title={tool.blocked ?? tool.label} onClick={tool.onRun}>
              {tool.label}
            </button>
            <span className="edit-row-status">{tool.blocked ?? tool.hint ?? ""}</span>
          </div>
        ))}
      </section>
        </>
      )}
      {feedback && <div className="clipboard-status edit-feedback">{feedback}</div>}
    </div>
  );
}
