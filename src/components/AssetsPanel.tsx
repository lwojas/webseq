import { useRef } from "react";
import type { Asset, AssetId, FxTarget, TrackId } from "../model/types";

interface Props {
  assets: Asset[];
  /** Whichever track/master is currently selected elsewhere in the UI (see App.tsx's
   * selectedTarget) — "Assign" targets this track, and is disabled when it's "master" (master
   * has no sample slot to assign into, same rationale as MasterRow having no Load button). */
  selectedTarget: FxTarget;
  onImport: (file: File) => void;
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
  onAssign,
  onRename,
  onRemove,
  auditioningAssetId,
  onAudition,
  auditionDisabled,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canAssign = selectedTarget !== "master";

  return (
    <div className="assets-panel">
      <div className="assets-panel-header">
        <span className="pattern-bar-label">Assets</span>
        <button className="btn small" onClick={() => fileInputRef.current?.click()}>
          + Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImport(file);
            e.target.value = "";
          }}
        />
      </div>
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
