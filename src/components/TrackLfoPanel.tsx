import { LFO_DIVISIONS } from "webdsp";
import { LFO_WAVEFORMS } from "../model/instruments";
import type { LfoWaveformId, TrackEventLfo } from "../model/types";
import { RATE_STEPS, formatRate, rateToSlider, sliderToRate } from "./ModulationSlot";

interface Props {
  lfo: TrackEventLfo;
  /** How many steps of this track (in the shown pattern) take part, and how many there are. */
  participating: number;
  stepCount: number;
  onChange: (patch: Partial<TrackEventLfo>) => void;
  /** Sets participation of every step of the track in the shown pattern. */
  onSetAllSteps: (amount: number) => void;
}

const WAVE_LABEL: Record<string, string> = { sine: "Sine", triangle: "Tri", square: "Sq", saw: "Saw" };

/** The Track LFO controls in the Track Editor: an LFO that changes the velocity of the steps
 * that opt in (each step's LFO slider below the lane). It acts when a step is scheduled, not
 * inside the synth. Same control language as the synth Modulation card. */
export function TrackLfoPanel({ lfo, participating, stepCount, onChange, onSetAllSteps }: Props) {
  return (
    <div className="track-lfo">
      <div className="track-lfo-head">
        <span className="mod-slot-title">Track LFO</span>
        <div className="enum-toggle track-lfo-onoff">
          <button className={lfo.enabled ? "active" : ""} onClick={() => onChange({ enabled: true })}>
            On
          </button>
          <button className={lfo.enabled ? "" : "active"} onClick={() => onChange({ enabled: false })}>
            Off
          </button>
        </div>
        <span className="track-lfo-target">
          Target <b>Velocity</b>
        </span>
        <span className="track-lfo-steps">
          {participating}/{stepCount} steps
        </span>
        <button className="btn small" disabled={stepCount === 0} onClick={() => onSetAllSteps(1)} title="Make every step of this track follow the LFO">
          All steps
        </button>
        <button className="btn small" disabled={participating === 0} onClick={() => onSetAllSteps(0)} title="Remove every step of this track from the LFO">
          None
        </button>
      </div>
      <div className={`module-params${lfo.enabled ? "" : " track-lfo-off"}`}>
        <div className="module-param">
          <span className="param-label static">Waveform</span>
          <div className="enum-toggle">
            {LFO_WAVEFORMS.map((w: LfoWaveformId) => (
              <button key={w} className={w === lfo.waveform ? "active" : ""} onClick={() => onChange({ waveform: w })}>
                {WAVE_LABEL[w]}
              </button>
            ))}
          </div>
        </div>
        <div className="module-param">
          <span className="param-label static">Mode</span>
          <div className="enum-toggle">
            <button className={lfo.sync ? "active" : ""} onClick={() => onChange({ sync: true })}>
              Sync
            </button>
            <button className={lfo.sync ? "" : "active"} onClick={() => onChange({ sync: false })}>
              Free
            </button>
          </div>
        </div>
        {lfo.sync ? (
          <div className="module-param">
            <span className="param-label static">Rate</span>
            <select value={lfo.division} onChange={(e) => onChange({ division: e.target.value })} aria-label="Track LFO division">
              {LFO_DIVISIONS.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
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
                onChange={(e) => onChange({ rateHz: sliderToRate(Number(e.target.value)) })}
                aria-label="Track LFO rate"
              />
              <span className="value">{formatRate(lfo.rateHz)}Hz</span>
            </div>
          </div>
        )}
        <div className="module-param">
          <span className="param-label static">Depth</span>
          <div className="range-row">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(lfo.depth * 100)}
              onChange={(e) => onChange({ depth: Number(e.target.value) / 100 })}
              aria-label="Track LFO depth"
            />
            <span className="value">{Math.round(lfo.depth * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
