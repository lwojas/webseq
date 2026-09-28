import type { AudioModule } from "../modules/types";

interface Props {
  module: AudioModule;
}

/** Renders any AudioModule generically from its `parameters` list — this component has no
 * idea it's rendering a filter specifically, so a future delay/reverb/compressor module
 * needs no new UI code, only a new AudioModule implementation (see modules/types.ts). */
export function ModulePanel({ module }: Props) {
  return (
    <div className="module-panel">
      <div className="module-panel-header">
        <span className="name">{module.name}</span>
        <button
          className={`btn ${module.enabled ? "active" : ""}`}
          onClick={() => module.setEnabled(!module.enabled)}
        >
          {module.enabled ? "On" : "Bypassed"}
        </button>
      </div>
      <div className="module-params">
        {module.parameters.map((param) => (
          <div className="module-param" key={param.id}>
            <label>{param.label}</label>
            {param.kind === "enum" ? (
              <div className="enum-toggle">
                {param.options?.map((opt) => (
                  <button
                    key={opt.value}
                    className={opt.value === param.value ? "active" : ""}
                    onClick={() => module.setParameter(param.id, opt.value)}
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
                  step={param.step ?? 1}
                  value={param.value}
                  onChange={(e) => module.setParameter(param.id, Number(e.target.value))}
                />
                <span className="value">
                  {param.value < 10 ? param.value.toFixed(2) : Math.round(param.value)}
                  {param.unit ?? ""}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
