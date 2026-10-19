import { FX_DEFS } from "../model/fx";
import type { AutomationLane as AutomationLaneModel, FxId, FxTarget, FxType, Track, TrackId } from "../model/types";
import { resolvedOutput } from "../model/types";
import { canRouteTo } from "../model/project";
import { findLane } from "../model/automation";
import { FxChainStrip } from "./FxChainStrip";
import { ModulePanel } from "./ModulePanel";
import { AutomationLane } from "./AutomationLane";

interface Props {
  target: FxTarget;
  track: Track | null; // the selected Track, or null when target === "master"
  /** Every track in the project, in order — the routing destinations on offer. */
  tracks: Track[];
  onSetOutput: (trackId: TrackId, dest: TrackId | null) => void;
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
  onMoveFx: (id: FxId, index: number) => void;
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
  tracks,
  onSetOutput,
  fx,
  automation,
  patternTotalBeats,
  pxPerBeat,
  selectedFxId,
  selectedAutomationParamId,
  onSelectFx,
  onAddFx,
  onRemoveFx,
  onMoveFx,
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
      {track && <RoutingRow track={track} tracks={tracks} onSetOutput={onSetOutput} />}
      <FxChainStrip fx={fx} selectedFxId={selectedFxId} onSelectFx={onSelectFx} onAddFx={onAddFx} onRemoveFx={onRemoveFx} onMoveFx={onMoveFx} />

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
        <div className="fx-panel-empty">No FX yet — use + Add FX above. Effects run left to right; add the same one twice to stack it.</div>
      )}
    </div>
  );
}

/** Where the selected track sends its audio once its own FX chain has run: the master (default)
 * or another track, which then runs it through that track's FX chain. Destinations that would
 * loop back (or the track itself) are left out of the list, so an invalid route can't be picked. */
function RoutingRow({ track, tracks, onSetOutput }: { track: Track; tracks: Track[]; onSetOutput: Props["onSetOutput"] }) {
  const project = { tracks } as import("../model/types").Project;
  const current = resolvedOutput(project, track);
  const incoming = tracks.filter((t) => t.id !== track.id && resolvedOutput(project, t) === track.id).length;
  return (
    <div className="track-mode-row">
      <label className="track-mode-group">
        <span className="track-mode-label">Output</span>
        <select
          className="fx-add-select"
          value={current}
          onChange={(e) => onSetOutput(track.id, e.target.value === "master" ? null : e.target.value)}
          aria-label="Send this track's audio to"
        >
          <option value="master">Master</option>
          {tracks.map((t, i) =>
            t.id === current || canRouteTo(project, track.id, t.id) ? (
              <option key={t.id} value={t.id}>
                {String(i + 1).padStart(2, "0")} · {t.name}
              </option>
            ) : null,
          )}
        </select>
      </label>
      {incoming > 0 && (
        <span className="track-mode-label" title="Tracks routed into this one run through its FX chain">
          Receiving from {incoming} track{incoming === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}
