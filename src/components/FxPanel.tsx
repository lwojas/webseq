import { FX_DEFS } from "../model/fx";
import type { AutomationLane as AutomationLaneModel, FxId, FxTarget, FxType, PlaybackMode, Track, TrackId, VoiceMode } from "../model/types";
import { effectivePlaybackMode, effectiveVoiceMode } from "../model/types";
import { findLane } from "../model/automation";
import { FxChainStrip } from "./FxChainStrip";
import { ModulePanel } from "./ModulePanel";
import { AutomationLane } from "./AutomationLane";

interface Props {
  target: FxTarget;
  track: Track | null; // the selected Track, or null when target === "master"
  fx: import("../model/types").FxInstance[];
  automation: AutomationLaneModel[];
  patternTotalBeats: number;
  /** Current timeline zoom level, in pixels per beat — threaded through to AutomationLane so
   * it stays pixel-aligned with the main grid (see timelineConstants.ts, ECS-53). */
  pxPerBeat: number;
  selectedFxId: FxId | null;
  selectedAutomationParamId: string | null;
  onSelectFx: (id: FxId) => void;
  onAddFx: (type: FxType) => void;
  onRemoveFx: (id: FxId) => void;
  onSetFxParam: (fxId: FxId, paramId: string, value: number) => void;
  onSetFxEnabled: (fxId: FxId, enabled: boolean) => void;
  onSelectAutomationParam: (paramId: string) => void;
  onSetAutomationPoint: (fxId: FxId, parameter: string, position: number, value: number) => void;
  onRemoveAutomationPoint: (fxId: FxId, parameter: string, position: number) => void;
  onClearAutomationLane: (fxId: FxId, parameter: string) => void;
  onSetPlaybackMode: (trackId: TrackId, mode: PlaybackMode) => void;
  onSetVoiceMode: (trackId: TrackId, mode: VoiceMode) => void;
  /** Whether the selected track has any notes in the currently shown pattern — hides the
   * "Clear sequence" control below when there's nothing to clear (ECS-107). */
  hasNotes: boolean;
  onClearTrack: (trackId: TrackId) => void;
  /** Whether there's a copied track clipboard to paste (ECS-112) — hides "Paste sequence" when
   * there's nothing to paste, same rationale as hasNotes above for Copy/Clear. */
  canPaste: boolean;
  /** Transient "Track 03 · 4 notes" feedback after Copy/Paste — cleared by App.tsx after a
   * couple seconds, same pattern as TransportBar's save/resample status. */
  clipboardStatus: string | null;
  onCopyTrack: (trackId: TrackId) => void;
  onPasteTrack: () => void;
  /** Whether the selected track has any reusable configuration worth copying (ECS-124) —
   * hides "Copy config" when there's nothing to copy, same rationale as hasNotes/hasConfig. */
  hasConfig: boolean;
  /** Whether there's a copied track-config clipboard to paste (ECS-124) — a separate clipboard
   * from canPaste/noteClipboard above, see App.tsx's trackConfigClipboard doc comment. */
  canPasteConfig: boolean;
  onCopyTrackConfig: (trackId: TrackId) => void;
  onPasteTrackConfig: () => void;
}

/** The bottom module panel, contextual to whatever is currently selected in the timeline — a
 * track or MASTER (see project brief section 12). Replaces the original prototype's single
 * hand-wired master-filter strip: FX chain, per-FX parameters, and that FX's automation are
 * all rendered generically from the model (model/fx.ts's FX_DEFS), so a third FX type needs
 * no new component here. */
export function FxPanel({
  target,
  track,
  fx,
  automation,
  patternTotalBeats,
  pxPerBeat,
  selectedFxId,
  selectedAutomationParamId,
  onSelectFx,
  onAddFx,
  onRemoveFx,
  onSetFxParam,
  onSetFxEnabled,
  onSelectAutomationParam,
  onSetAutomationPoint,
  onRemoveAutomationPoint,
  onClearAutomationLane,
  onSetPlaybackMode,
  onSetVoiceMode,
  hasNotes,
  onClearTrack,
  canPaste,
  clipboardStatus,
  onCopyTrack,
  onPasteTrack,
  hasConfig,
  canPasteConfig,
  onCopyTrackConfig,
  onPasteTrackConfig,
}: Props) {
  const selectedFx = fx.find((f) => f.id === selectedFxId) ?? null;
  const title = target === "master" ? "MASTER" : `${track?.name ?? target}`;
  const paramDef = selectedFx ? FX_DEFS[selectedFx.type].params.find((p) => p.id === selectedAutomationParamId) : undefined;
  const lane = selectedFx && selectedAutomationParamId ? findLane(automation, selectedFx.id, selectedAutomationParamId) : undefined;

  return (
    <div className="fx-panel">
      <div className="fx-panel-title">{title} — FX CHAIN</div>
      {/* Contextual to the selected track only (ECS-82/ECS-88) — master has no asset/trigger
          concept, same rationale as AssetsPanel's "Assign" being disabled for master and
          TrackRow having no Load button for it. Deliberately not on TrackRow/MixerPanel: those
          render every track at once, and a per-row control here would be exactly the
          persistent UI clutter ECS-81 asks to avoid. */}
      {track && (
        <div className="track-mode-row">
          <div className="track-mode-group">
            <span className="track-mode-label">Mode</span>
            <div className="track-mode-toggle">
              {(["one-shot", "loop"] as const).map((mode) => (
                <button
                  key={mode}
                  className={effectivePlaybackMode(track) === mode ? "active" : ""}
                  onClick={() => onSetPlaybackMode(track.id, mode)}
                  title={mode === "loop" ? "Tile the sample to fill this track's note lengths" : "Play through once, bounded by note length"}
                >
                  {mode === "one-shot" ? "One-shot" : "Loop"}
                </button>
              ))}
            </div>
          </div>
          <div className="track-mode-group">
            <span className="track-mode-label">Voice</span>
            <div className="track-mode-toggle">
              {(["poly", "mono"] as const).map((mode) => (
                <button
                  key={mode}
                  className={effectiveVoiceMode(track) === mode ? "active" : ""}
                  onClick={() => onSetVoiceMode(track.id, mode)}
                  title={mode === "mono" ? "This track's own voices never overlap each other" : "This track's voices may overlap (default)"}
                >
                  {mode === "poly" ? "Poly" : "Mono"}
                </button>
              ))}
            </div>
          </div>
          {/* Whole-track copy/paste (ECS-112) and clear (ECS-107) share this row for the same
              reason: Cmd/Ctrl+C/V and Delete/Backspace (App.tsx's keydown handler) are the
              desktop equivalents, but touch has no reliable keyboard. Each button is its own
              direct child of .track-mode-row (not grouped in a shared, non-wrapping
              .track-mode-group) so the row's existing flex-wrap can reflow them individually on
              narrow viewports, the same mechanism already wrapping Mode/Voice above — not a new
              overflow strategy. This is also the mobile-safe surface generally, unlike
              TrackRow's header column which has no room to spare for more buttons. */}
          {hasNotes && (
            <button
              className="track-copy-btn"
              onClick={() => onCopyTrack(track.id)}
              title={`Copy every note in ${track.name}'s sequence (this pattern) to the clipboard`}
            >
              Copy sequence
            </button>
          )}
          {canPaste && (
            <button
              className="track-paste-btn"
              onClick={onPasteTrack}
              title={`Paste the copied sequence onto ${track.name}, in this pattern`}
            >
              Paste sequence
            </button>
          )}
          {hasNotes && (
            <button
              className="track-clear-btn"
              onClick={() => onClearTrack(track.id)}
              title={`Remove every note from ${track.name}'s sequence in this pattern — no undo`}
            >
              Clear sequence
            </button>
          )}
          {/* Reusable track-configuration copy/paste (ECS-124) — asset reference, FX chain,
              automation, playback/voice mode. A separate clipboard from Copy/Paste sequence
              above (see App.tsx's trackConfigClipboard doc comment); same per-button wrapping
              approach. */}
          {hasConfig && (
            <button
              className="track-copy-btn"
              onClick={() => onCopyTrackConfig(track.id)}
              title={`Copy ${track.name}'s asset/FX/automation/playback config to the clipboard`}
            >
              Copy config
            </button>
          )}
          {canPasteConfig && (
            <button
              className="track-paste-btn"
              onClick={onPasteTrackConfig}
              title={`Paste the copied config onto ${track.name} — replaces its asset/FX/automation/playback config, no undo`}
            >
              Paste config
            </button>
          )}
          {clipboardStatus && <div className="clipboard-status">{clipboardStatus}</div>}
        </div>
      )}
      <FxChainStrip fx={fx} selectedFxId={selectedFxId} onSelectFx={onSelectFx} onAddFx={onAddFx} onRemoveFx={onRemoveFx} />

      {selectedFx && (
        <div className="fx-panel-detail">
          <ModulePanel
            fx={selectedFx}
            onSetParam={(paramId, value) => onSetFxParam(selectedFx.id, paramId, value)}
            onSetEnabled={(enabled) => onSetFxEnabled(selectedFx.id, enabled)}
            automatedParamId={selectedAutomationParamId}
            onSelectAutomatedParam={onSelectAutomationParam}
          />
          {paramDef && (
            <AutomationLane
              lane={lane}
              paramDef={paramDef}
              totalBeats={patternTotalBeats}
              pxPerBeat={pxPerBeat}
              onSetPoint={(position, value) => onSetAutomationPoint(selectedFx.id, paramDef.id, position, value)}
              onRemovePoint={(position) => onRemoveAutomationPoint(selectedFx.id, paramDef.id, position)}
              onClear={() => onClearAutomationLane(selectedFx.id, paramDef.id)}
            />
          )}
        </div>
      )}
      {fx.length === 0 && (
        <div className="fx-panel-empty">No FX yet — add a Filter, Chorus/Flanger, Delay, Reverb, Compressor, or Saturation above.</div>
      )}
    </div>
  );
}
