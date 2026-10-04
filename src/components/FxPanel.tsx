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
