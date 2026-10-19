import { useState } from "react";
import { DEFAULT_LFO_DIVISION, LFO_MAX_RATE_HZ, LFO_MIN_RATE_HZ, MAX_TRACK_LFOS } from "../model/lfoStack";
import { AUTOMATION_TEMPLATES, templateById, type TemplateRange } from "../model/automationTemplates";
import type { ModParamDef } from "../model/modulation";
import type { AutomationLane as AutomationLaneModel, LfoWaveformId, TrackLfo } from "../model/types";
import { AutomationLane, formatBars } from "./AutomationLane";

/** What the engine reports for the selected synth (webdsp getModulationInfo / getModulationTargets).
 * The slot renders only from this: target and option lists are never hard-coded per synth. */
export interface ModulationUi {
  maxLfos: number;
  waveforms: string[];
  divisions: string[];
  /** Control ids (engine param names) the selected synth allows an LFO to target. */
  targets: string[];
}

/** Automation as a modulation source of the owner's parameters (an FX instance, a synth, a
 * sample). Everything is addressed by parameter id; the owner (which FX / track) is bound by the
 * caller. */
export interface AutomationUi {
  /** The owner's automatable parameters. */
  params: ModParamDef[];
  /** The owner's lanes. */
  lanes: AutomationLaneModel[];
  /** The parameter whose lane is open for editing (in the timeline row, or inline below). */
  focused: string | null;
  /** Sequence length, for the lane's length readout and for templates. */
  totalBeats: number;
  beatsPerBar: number;
  pxPerBeat: number;
  /** Draw the lane inside the card: used when the timeline is not on screen (phone Track tab, the
   * Patterns page). Otherwise the lane is a row of the timeline. */
  inline: boolean;
  onAdd: (param: string) => void;
  onFocus: (param: string | null) => void;
  /** Wipes the curve back to a flat line at the parameter's current value; the lane stays. */
  onReset: (param: string) => void;
  onRemove: (param: string) => void;
  onMove: (from: string, to: string) => void;
  onTemplate: (param: string, templateId: string, range: TemplateRange) => void;
  onSetPoint: (param: string, position: number, value: number) => void;
  onRemovePoint: (param: string, position: number) => void;
}

interface Props {
  lfos: readonly TrackLfo[];
  /** Engine-reported LFO options, or null when this owner has no LFO bank (a sample track). */
  ui: ModulationUi | null;
  /** Display label for a control id (falls back to the id). */
  labelFor: (target: string) => string;
  onAdd: (target: string) => void;
  onChange: (index: number, patch: Partial<TrackLfo>) => void;
  onRemove: (index: number) => void;
  automation?: AutomationUi;
}

/** Which of a parameter's modulation sources exist: drives the marker on the parameter's own row. */
export function modulationBadges(lanes: readonly AutomationLaneModel[], lfos: readonly TrackLfo[]): Record<string, { auto: boolean; lfos: number }> {
  const out: Record<string, { auto: boolean; lfos: number }> = {};
  for (const l of lanes) (out[l.parameter] ??= { auto: false, lfos: 0 }).auto = true;
  for (const l of lfos) (out[l.target] ??= { auto: false, lfos: 0 }).lfos++;
  return out;
}

/** The small marker beside a parameter name: A = automated, L/Ln = n LFOs. */
export function ModBadge({ badge }: { badge: { auto: boolean; lfos: number } | undefined }) {
  if (!badge || (!badge.auto && badge.lfos === 0)) return null;
  const text = `${badge.auto ? "A" : ""}${badge.lfos > 0 ? (badge.auto ? "+" : "") + "L" + (badge.lfos > 1 ? badge.lfos : "") : ""}`;
  return (
    <span className="mod-badge" title={`${badge.auto ? "Automated" : ""}${badge.auto && badge.lfos ? " + " : ""}${badge.lfos ? `${badge.lfos} LFO${badge.lfos > 1 ? "s" : ""}` : ""}`}>
      {text}
    </span>
  );
}

const WAVE_LABEL: Record<string, string> = { sine: "Sine", triangle: "Tri", square: "Sq", saw: "Saw" };

// Rate is a log-scaled slider (0.01-40 Hz spans four decades).
export const RATE_STEPS = 1000;
export const rateToSlider = (hz: number) => Math.round((Math.log(hz / LFO_MIN_RATE_HZ) / Math.log(LFO_MAX_RATE_HZ / LFO_MIN_RATE_HZ)) * RATE_STEPS);
export const sliderToRate = (v: number) => LFO_MIN_RATE_HZ * Math.pow(LFO_MAX_RATE_HZ / LFO_MIN_RATE_HZ, v / RATE_STEPS);
export const formatRate = (hz: number) => (hz < 1 ? hz.toFixed(2) : hz < 10 ? hz.toFixed(1) : String(Math.round(hz)));

/** The modulation card, shared by the synth editor, the sample editor and the FX panel: one list
 * of modulation sources for the owner's parameters. A source is an Automation lane (the curve
 * drawn over the sequence) or an LFO (the engine's, stackable); each names its target parameter,
 * and several may share one (automation sets the base, the LFOs ride on it). Free-mode LFOs show
 * Rate (Hz), BPM-sync mode a Division. Deliberately not a matrix: one source, one target, a
 * handful of slots. */
export function ModulationSlot({ lfos, ui, labelFor, onAdd, onChange, onRemove, automation }: Props) {
  const [range, setRange] = useState<TemplateRange>("all");
  const lfoTargets = ui?.targets ?? [];
  if (lfoTargets.length === 0 && !automation) return null;
  const max = ui ? Math.min(ui.maxLfos, MAX_TRACK_LFOS) : 0;
  const freeParams = automation ? automation.params.filter((p) => !automation.lanes.some((l) => l.parameter === p.id)) : [];
  const bars = automation ? automation.totalBeats / automation.beatsPerBar : 1;
  const nothing = lfos.length === 0 && (automation?.lanes.length ?? 0) === 0;
  return (
    <div className="mod-slot">
      <div className="module-panel-header">
        <span className="mod-slot-title">Modulation</span>
        <span className="mod-slot-actions">
          {automation && (
            <button
              className="btn small"
              disabled={freeParams.length === 0}
              onClick={() => automation.onAdd((freeParams.find((p) => p.id === "cutoff" || p.id === "gain") ?? freeParams.find((p) => !p.options) ?? freeParams[0]).id)}
              title="Draw a curve for a parameter over the sequence"
            >
              + Automation
            </button>
          )}
          {lfoTargets.length > 0 && (
            <button className="btn small" disabled={lfos.length >= max} onClick={() => onAdd(lfoTargets.includes("cutoff") ? "cutoff" : lfoTargets[0])} title="Add an LFO">
              + LFO
            </button>
          )}
        </span>
      </div>
      {nothing && <div className="instrument-hint">{lfoTargets.length > 0 ? "No modulation. Add automation or an LFO to move a control over time." : "No automation. Add one to move a control over time."}</div>}
      {automation &&
        automation.lanes.map((lane) => {
          const def = automation.params.find((p) => p.id === lane.parameter);
          if (!def) return null;
          const focused = automation.focused === lane.parameter;
          return (
            <div key={`auto-${lane.parameter}`} className={`mod-lfo mod-auto ${focused ? "focused" : ""}`}>
              <div className="mod-lfo-head">
                <span className="mod-lfo-title">
                  Automation <span className="mod-bars" title="Length of the lane">{formatBars(bars)}</span>
                </span>
                <span className="mod-slot-actions">
                  <button className={`btn small ${focused ? "active" : ""}`} onClick={() => automation.onFocus(focused ? null : lane.parameter)} title="Show this curve for editing">
                    {focused ? "Editing" : "Edit"}
                  </button>
                  <button className="btn small danger" onClick={() => automation.onRemove(lane.parameter)} title="Remove this automation">
                    Remove
                  </button>
                </span>
              </div>
              <div className="module-params">
                <div className="module-param">
                  <span className="param-label static">Target</span>
                  <select value={lane.parameter} onChange={(e) => automation.onMove(lane.parameter, e.target.value)} aria-label="Automation target">
                    <option value={lane.parameter}>{def.label}</option>
                    {freeParams.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                {!def.options && (
                  <div className="module-param">
                    <span className="param-label static">Shape</span>
                    <div className="mod-shape">
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) automation.onTemplate(lane.parameter, e.target.value, bars > 1 ? range : "all");
                        }}
                        aria-label="Apply a shape"
                      >
                        <option value="">Apply shape…</option>
                        {AUTOMATION_TEMPLATES.map((t) => (
                          <option key={t.id} value={t.id} title={templateById(t.id)?.hint}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      {bars > 1 && (
                        <div className="enum-toggle" role="group" aria-label="Where on the sequence">
                          {([["all", "All"], ["start", "Bar 1"], ["end", "Last bar"]] as const).map(([r, text]) => (
                            <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>
                              {text}
                            </button>
                          ))}
                        </div>
                      )}
                      <button className="btn small" onClick={() => automation.onReset(lane.parameter)} title="Clear the curve back to a flat line">
                        Clear
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {focused && automation.inline && (
                <div className="mod-auto-inline">
                  <AutomationLane
                    lane={lane}
                    paramDef={def}
                    totalBeats={automation.totalBeats}
                    beatsPerBar={automation.beatsPerBar}
                    pxPerBeat={automation.pxPerBeat}
                    onSetPoint={(pos, v) => automation.onSetPoint(lane.parameter, pos, v)}
                    onRemovePoint={(pos) => automation.onRemovePoint(lane.parameter, pos)}
                  />
                </div>
              )}
              {focused && !automation.inline && <div className="instrument-hint">The curve is the highlighted row in the timeline, under this track.</div>}
            </div>
          );
        })}
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
                {ui!.waveforms.map((w) => (
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
                  value={ui!.divisions.includes(lfo.division) ? lfo.division : DEFAULT_LFO_DIVISION}
                  onChange={(e) => onChange(i, { division: e.target.value })}
                  aria-label={`LFO ${i + 1} division`}
                >
                  {ui!.divisions.map((d) => (
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
                {!lfoTargets.includes(lfo.target) && <option value={lfo.target}>{labelFor(lfo.target)} (n/a)</option>}
                {lfoTargets.map((t) => (
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
