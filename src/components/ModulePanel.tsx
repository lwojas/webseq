import { FX_DEFS } from "../model/fx";
import type { FxInstance } from "../model/types";

interface Props {
  fx: FxInstance;
  onSetParam: (paramId: string, value: number) => void;
  onSetEnabled: (enabled: boolean) => void;
  /** Which parameter (if any) currently has its automation shown below this panel — passed
   * through so a param row can indicate "this is the one being automated". */
  automatedParamId: string | null;
  onSelectAutomatedParam: (paramId: string) => void;
}

/** Renders any FxInstance generically from FX_DEFS (model/fx.ts) — this component has no idea
 * it's rendering a filter vs. a delay specifically, so a future third FX type needs no new UI
 * code here, only an FX_DEFS entry and an audio/applyFx.ts case. Clicking a parameter's label
 * selects it as the one whose automation is shown in the lane below (see AutomationLane). */
export function ModulePanel({ fx, onSetParam, onSetEnabled, automatedParamId, onSelectAutomatedParam }: Props) {
  const def = FX_DEFS[fx.type];

  return (
    <div className="module-panel">
      <div className="module-panel-header">
        <span className="name">{def.label}</span>
        <button className={`btn ${fx.enabled ? "active" : ""}`} onClick={() => onSetEnabled(!fx.enabled)}>
          {fx.enabled ? "On" : "Bypassed"}
        </button>
      </div>
      <div className="module-params">
        {def.params.map((param) => {
          const value = fx.params[param.id] ?? param.default;
          return (
            <div className="module-param" key={param.id}>
              <button
                className={`param-label ${automatedParamId === param.id ? "automated" : ""}`}
                onClick={() => onSelectAutomatedParam(param.id)}
                title="Show/edit automation for this parameter"
              >
                {param.label}
                {automatedParamId === param.id && <span className="automation-dot" />}
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
    </div>
  );
}
