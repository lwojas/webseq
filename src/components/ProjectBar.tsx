interface Props {
  saveStatus: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
  savedProjects: { id: string; name: string }[];
  loadTargetId: string;
  onNew: () => void;
  onSave: () => void;
  onSelectSaved: (id: string) => void;
  onLoad: () => void;
  onDelete: () => void;
  /** Writes the project as a file / opens one. A file is how a project moves between the browser and a plugin. */
  onExport: () => void;
  onImport: () => void;
  /** Why the last export or import failed, shown until the next attempt; null when it did not. */
  fileError: string | null;
}

/** New / Save / Load / Delete for the project. Inline in the desktop top bar; on a phone it lives
 * in the ⋯ Settings view (SettingsView) so the top bar can stay one row. */
export function ProjectBar({ saveStatus, saveError, savedProjects, loadTargetId, onNew, onSave, onSelectSaved, onLoad, onDelete, onExport, onImport, fileError }: Props) {
  return (
    <div className="project-controls">
      <button className="btn small" onClick={onNew}>
        New
      </button>
      <button className="btn small" onClick={onSave} disabled={saveStatus === "saving"}>
        {saveStatus === "saving" ? "Saving…" : "Save"}
      </button>
      {saveStatus === "saved" && <span className="save-status saved">Saved ✓</span>}
      {saveStatus === "error" && (
        <span className="save-status error" title={saveError ?? undefined}>
          Save failed
        </span>
      )}
      <select className="project-select" value={loadTargetId} onChange={(e) => onSelectSaved(e.target.value)}>
        <option value="">— saved projects —</option>
        {savedProjects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="btn small" onClick={onLoad} disabled={!loadTargetId}>
        Load
      </button>
      <button className="btn small danger" onClick={onDelete} disabled={!loadTargetId}>
        Delete
      </button>
      <button className="btn small" onClick={onExport} title="Save the project, with its audio, as a file you can open in another browser or in the plugin">
        Export
      </button>
      <button className="btn small" onClick={onImport} title="Open a project file">
        Import
      </button>
      {fileError && (
        <span className="save-status error" title={fileError}>
          File failed
        </span>
      )}
    </div>
  );
}
