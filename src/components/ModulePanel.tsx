import { FX_DEFS, keyTrackId, keyTrackValue } from "../model/fx";
import type { FxInstance, Track, TrackId } from "../model/types";
import { EqCurveEditor } from "./EqCurveEditor";
import type { SpectrumTap } from "../viz/useSpectrumCanvas";
import { ModBadge } from "./ModulationSlot";

interface Props {
  fx: FxInstance;
  /** Every track, for parameters that name one (the compressor sidechain), and the track this FX
   * sits on (null on master), which cannot key itself. */
  tracks?: Track[];
  ownerTrackId?: TrackId | null;
  onSetParam: (paramId: string, value: number) => void;
  onSetEnabled: (enabled: boolean) => void;
  /** Which modulation sources each parameter has (see modulationBadges), shown beside its name. */
  badges: Record<string, { auto: boolean; lfos: number }>;
  /** Clicking a parameter's name automates it: adds a lane if there is none, else opens it. */
  onAutomateParam: (paramId: string) => void;
  /** Live-spectrum source for an EQ (the engine effect's input), or undefined without an engine. */
  spectrumTap?: () => SpectrumTap | null;
  /** The modulation card (automation + LFOs) for this FX, rendered below its parameters. */
  children?: React.ReactNode;
}

/** Renders any FxInstance generically from FX_DEFS (model/fx.ts) — this component has no idea
 * it's rendering a filter vs. a delay specifically, so a new FX type needs no new UI
 * code here, only an FX_DEFS entry and an audio/fxChain.ts mapping (FX_KIND and its parameter ids). Clicking a parameter's label
 * selects it as the one whose automation is shown in the lane below (see AutomationLane). */
export function ModulePanel({ fx, tracks = [], ownerTrackId = null, onSetParam, onSetEnabled, badges, onAutomateParam, spectrumTap, children }: Props) {
  const def = FX_DEFS[fx.type];

  const paramsBlock = (
    <div className="module-params">
        {def.params.map((param) => {
          const value = fx.params[param.id] ?? param.default;
          if (param.trackKey) {
            // The value is a track number; a value whose track is gone still shows, so it can be cleared.
            const keyable = tracks.filter((t) => t.id !== ownerTrackId && keyTrackValue(t.id) > 0);
            return (
              <div className="module-param" key={param.id}>
                <span className="param-label static">{param.label}</span>
                <select value={value} onChange={(e) => onSetParam(param.id, Number(e.target.value))} title="The track whose signal drives this effect">
                  <option value={0}>Off (own input)</option>
                  {value > 0 && !keyable.some((t) => keyTrackValue(t.id) === value) && <option value={value}>{keyTrackId(value) ?? "?"} (unavailable)</option>}
                  {keyable.map((t) => (
                    <option key={t.id} value={keyTrackValue(t.id)}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          return (
            <div className="module-param" key={param.id}>
              <button className="param-label" onClick={() => onAutomateParam(param.id)} title="Automate this parameter">
                {param.label}
                <ModBadge badge={badges[param.id]} />
              </button>
              {param.options ? (
                <div className="enum-toggle">
                  {param.options.map((opt) => (
                    <button
                      key={opt.value}
                      className={opt.value === value ? "active" : ""}
                      onClick={() => onSetParam(param.id, opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="range-row">
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={value}
                    onChange={(e) => onSetParam(param.id, Number(e.target.value))}
                  />
                  <span className="value">
                    {value < 10 ? value.toFixed(2) : Math.round(value)}
                    {param.unit ?? ""}
                  </span>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );

  return (
    <div className="module-panel">
      <div className="module-panel-header">
        <span className="name">{def.label}</span>
        <button className={`btn ${fx.enabled ? "active" : ""}`} onClick={() => onSetEnabled(!fx.enabled)}>
          {fx.enabled ? "On" : "Bypassed"}
        </button>
      </div>
      {fx.type === "eq" && <EqCurveEditor params={fx.params} onSetParam={onSetParam} spectrumTap={spectrumTap} spectrumKey={fx.id} />}
      {fx.type === "eq" ? (
        <details className="eq-all-params">
          <summary>All parameters (click a name to automate)</summary>
          {paramsBlock}
        </details>
      ) : (
        paramsBlock
      )}
      {children}
    </div>
  );
}
