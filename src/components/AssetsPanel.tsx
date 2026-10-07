import { useRef } from "react";
import type { Asset, AssetId, FxTarget, TrackId } from "../model/types";
import { estimateDecodedBytes, sampleBudgetBytes } from "../model/project";

const MB = 1024 * 1024;
const formatMB = (bytes: number) => `${(bytes / MB).toFixed(1)}`;

/** Result of the most recent import batch (one file counts as a batch of one), for the
 * import-status line — see ECS-130. Replaced wholesale by the next import; never accumulates. */
export interface ImportBatchResult {
  total: number;
  failed: { name: string; message: string }[];
}

interface Props {
  assets: Asset[];
  /** Whichever track/master is currently selected elsewhere in the UI (see App.tsx's
   * selectedTarget) — "Assign" targets this track, and is disabled when it's "master" (master
   * has no sample slot to assign into, same rationale as MasterRow having no Load button). */
  selectedTarget: FxTarget;
  onImport: (files: File[]) => void;
  importStatus: ImportBatchResult | null;
  onAssign: (trackId: TrackId, assetId: AssetId) => void;
  onRename: (assetId: AssetId, name: string) => void;
  onRemove: (assetId: AssetId) => void;
  /** The asset currently auditioning, if any (see audio/playback.ts) — drives its chip's active state. */
  auditioningAssetId: AssetId | null;
  onAudition: (assetId: AssetId) => void;
  /** True while a resample is armed or capturing. New auditions are refused then; stopping one is still allowed. */
  auditionDisabled: boolean;
}

/** The project-level Asset Bin: every imported or resampled audio resource, independent of
 * which track(s) currently use it. Deliberately simple — no waveform view, slicing, tagging,
 * folders, or search (see project brief section 4): a flat list, an inline rename, remove,
 * "assign to the currently selected track", and a per-chip audition (ECS-83). */
export function AssetsPanel({
  assets,
  selectedTarget,
  onImport,
  importStatus,
  onAssign,
  onRename,
  onRemove,
  auditioningAssetId,
  onAudition,
  auditionDisabled,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canAssign = selectedTarget !== "master";
  // Estimated engine memory for every asset in the bin, against a soft budget (ECS-84). Nothing
  // is blocked. The panel only tells the user when they are past it.
  const totalBytes = assets.reduce((sum, asset) => sum + estimateDecodedBytes(asset), 0);
  const coarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
  const budgetBytes = sampleBudgetBytes(coarsePointer);
  const overBudget = totalBytes > budgetBytes;
  // Only worth a status line when there's something to say: a failure, or more than one file
  // (a lone successful import is already visible as a new chip, so no extra line for it).
  const succeeded = importStatus ? importStatus.total - importStatus.failed.length : 0;
  const showImportStatus = importStatus !== null && (importStatus.failed.length > 0 || importStatus.total > 1);
  // The visible label is always a fixed shape (numbers only) — like `.save-status`'s "Save
  // failed", never raw filenames — since text-transform: uppercase would mangle arbitrary
  // content. Per-file detail goes in the title tooltip instead (see below).
  const importStatusText = importStatus
    ? importStatus.failed.length === 0
      ? `Imported ${importStatus.total}`
      : `Imported ${succeeded}/${importStatus.total} — ${importStatus.failed.length} failed`
    : null;

  return (
    <div className="assets-panel">
      <div className="assets-panel-header">
        <span className="pattern-bar-label">Assets</span>
        <span
          className={`assets-budget ${overBudget ? "over" : ""}`}
          title={overBudget ? "Over the soft sample budget. Loading more may be slow on this device." : "Estimated decoded sample memory"}
        >
          {formatMB(totalBytes)} / {formatMB(budgetBytes)} MB
        </span>
        <button className="btn small" onClick={() => fileInputRef.current?.click()}>
          + Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onImport(files);
            e.target.value = "";
          }}
        />
      </div>
      {showImportStatus && (
        <div className={`import-status ${importStatus!.failed.length > 0 ? "error" : ""}`} title={importStatus!.failed.map((f) => `${f.name}: ${f.message}`).join("\n") || undefined}>
          {importStatusText}
        </div>
      )}
      <div className="asset-chips">
        {assets.length === 0 && <span className="chain-empty">empty — import or resample something</span>}
        {assets.map((asset) => {
          const auditioning = auditioningAssetId === asset.id;
          return (
            <div key={asset.id} className="asset-chip">
              <span className={`asset-origin-badge ${asset.origin}`} title={asset.origin === "resample" ? "Resampled" : "Imported"}>
                {asset.origin === "resample" ? "R" : "I"}
              </span>
              <input
                className="asset-name-input"
                value={asset.name}
                onChange={(e) => onRename(asset.id, e.target.value)}
              />
              <div className="asset-chip-actions">
                <button
                  className={`btn small ${auditioning ? "active" : ""}`}
                  disabled={auditionDisabled && !auditioning}
                  title={auditioning ? "Stop audition" : "Audition"}
                  aria-label={`${auditioning ? "Stop" : "Audition"} ${asset.name}`}
                  onClick={() => onAudition(asset.id)}
                >
                  {auditioning ? "■" : "▶"}
                </button>
                <button
                  className="btn small"
                  disabled={!canAssign}
                  title={canAssign ? `Assign to the selected track` : "Select a track first"}
                  onClick={() => canAssign && onAssign(selectedTarget as TrackId, asset.id)}
                >
                  Assign
                </button>
                <button className="chain-remove" onClick={() => onRemove(asset.id)} title="Remove from the bin">
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
