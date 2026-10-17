import { DEFAULT_LFO_DIVISION, LFO_MAX_RATE_HZ, LFO_MIN_RATE_HZ, MAX_TRACK_LFOS } from "../model/instruments";
import type { LfoWaveformId, TrackLfo } from "../model/types";

/** What the engine reports for the selected synth (webdsp getModulationInfo / getModulationTargets).
 * The slot renders only from this: target and option lists are never hard-coded per synth. */
export interface ModulationUi {
  maxLfos: number;
  waveforms: string[];
  divisions: string[];
  /** Control ids (engine param names) the selected synth allows an LFO to target. */
  targets: string[];
}

interface Props {
  lfos: readonly TrackLfo[];
  ui: ModulationUi;
  /** Display label for a control id (falls back to the id). */
  labelFor: (target: string) => string;
  onAdd: (target: string) => void;
  onChange: (index: number, patch: Partial<TrackLfo>) => void;
  onRemove: (index: number) => void;
}

const WAVE_LABEL: Record<string, string> = { sine: "Sine", triangle: "Tri", square: "Sq", saw: "Saw" };

// Rate is a log-scaled slider (0.01-40 Hz spans four decades).
const RATE_STEPS = 1000;
const rateToSlider = (hz: number) => Math.round((Math.log(hz / LFO_MIN_RATE_HZ) / Math.log(LFO_MAX_RATE_HZ / LFO_MIN_RATE_HZ)) * RATE_STEPS);
const sliderToRate = (v: number) => LFO_MIN_RATE_HZ * Math.pow(LFO_MAX_RATE_HZ / LFO_MIN_RATE_HZ, v / RATE_STEPS);
const formatRate = (hz: number) => (hz < 1 ? hz.toFixed(2) : hz < 10 ? hz.toFixed(1) : String(Math.round(hz)));

/** The synth editor's modulation slot: a compact list of LFOs, each routed to one control of the
 * synth. Free mode shows Rate (Hz); BPM-sync mode swaps it for a Division. Deliberately not a
 * matrix: one LFO, one target, up to a handful of slots. */
export function ModulationSlot({ lfos, ui, labelFor, onAdd, onChange, onRemove }: Props) {
  if (ui.targets.length === 0) return null;
  const max = Math.min(ui.maxLfos, MAX_TRACK_LFOS);
  return (
    <div className="module-panel mod-slot">
      <div className="module-panel-header">
        <span className="name">Modulation</span>
        <button className="btn small" disabled={lfos.length >= max} onClick={() => onAdd(ui.targets.includes("cutoff") ? "cutoff" : ui.targets[0])} title="Add an LFO">
          + Add LFO
        </button>
      </div>
      {lfos.length === 0 && <div className="instrument-hint">No LFOs. Add one to move a control over time.</div>}
      {lfos.map((lfo, i) => (
        <div key={i} className="mod-lfo">
          <div className="mod-lfo-head">
            <span className="mod-lfo-title">LFO {i + 1}</span>
            <button className="btn small danger" onClick={() => onRemove(i)} title="Remove this LFO">
              Remove
            </button>
          </div>
          <div className="module-params">
            <div className="module-param">
              <span className="param-label static">Waveform</span>
              <div className="enum-toggle">
                {ui.waveforms.map((w) => (
                  <button key={w} className={w === lfo.waveform ? "active" : ""} onClick={() => onChange(i, { waveform: w as LfoWaveformId })}>
                    {WAVE_LABEL[w] ?? w}
                  </button>
                ))}
              </div>
            </div>
            <div className="module-param">
              <span className="param-label static">Sync</span>
              <div className="enum-toggle">
                <button className={lfo.sync ? "" : "active"} onClick={() => onChange(i, { sync: false })}>
                  Free
                </button>
                <button className={lfo.sync ? "active" : ""} onClick={() => onChange(i, { sync: true })}>
                  BPM
                </button>
              </div>
            </div>
            {lfo.sync ? (
              <div className="module-param">
                <span className="param-label static">Division</span>
                <select
                  value={ui.divisions.includes(lfo.division) ? lfo.division : DEFAULT_LFO_DIVISION}
                  onChange={(e) => onChange(i, { division: e.target.value })}
                  aria-label={`LFO ${i + 1} division`}
                >
                  {ui.divisions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="module-param">
                <span className="param-label static">Rate</span>
                <div className="range-row">
                  <input
                    type="range"
                    min={0}
                    max={RATE_STEPS}
                    step={1}
                    value={rateToSlider(lfo.rateHz)}
                    onChange={(e) => onChange(i, { rateHz: sliderToRate(Number(e.target.value)) })}
                    aria-label={`LFO ${i + 1} rate`}
                  />
                  <span className="value">{formatRate(lfo.rateHz)}Hz</span>
                </div>
              </div>
            )}
            <div className="module-param">
              <span className="param-label static">Amount</span>
              <div className="range-row">
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={Math.round(lfo.amount * 100)}
                  onChange={(e) => onChange(i, { amount: Number(e.target.value) / 100 })}
                  aria-label={`LFO ${i + 1} amount`}
                />
                <span className="value">{Math.round(lfo.amount * 100)}%</span>
              </div>
            </div>
            <div className="module-param">
              <span className="param-label static">Target</span>
              <select value={lfo.target} onChange={(e) => onChange(i, { target: e.target.value })} aria-label={`LFO ${i + 1} target`}>
                {!ui.targets.includes(lfo.target) && <option value={lfo.target}>{labelFor(lfo.target)} (n/a)</option>}
                {ui.targets.map((t) => (
                  <option key={t} value={t}>
                    {labelFor(t)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
