import { FX_DEFS } from "../model/fx";
import type { AutomationLane as AutomationLaneModel, FxId, FxTarget, FxType, Track } from "../model/types";
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
}: Props) {
  const selectedFx = fx.find((f) => f.id === selectedFxId) ?? null;
  const title = target === "master" ? "MASTER" : `${track?.name ?? target}`;
  const paramDef = selectedFx ? FX_DEFS[selectedFx.type].params.find((p) => p.id === selectedAutomationParamId) : undefined;
  const lane = selectedFx && selectedAutomationParamId ? findLane(automation, selectedFx.id, selectedAutomationParamId) : undefined;

  return (
    <div className="fx-panel">
      <div className="fx-panel-title">{title} — FX CHAIN</div>
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
              onSetPoint={(position, value) => onSetAutomationPoint(selectedFx.id, paramDef.id, position, value)}
              onRemovePoint={(position) => onRemoveAutomationPoint(selectedFx.id, paramDef.id, position)}
              onClear={() => onClearAutomationLane(selectedFx.id, paramDef.id)}
            />
          )}
        </div>
      )}
      {fx.length === 0 && <div className="fx-panel-empty">No FX yet — add a Filter, Delay, Reverb, Compressor, or Saturation above.</div>}
    </div>
  );
}
