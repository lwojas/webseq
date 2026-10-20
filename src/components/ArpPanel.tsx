import { useRef } from "react";
import {
  ARP_MODES,
  ARP_PATTERNS,
  ARP_RATES,
  ARP_VELOCITY_PRESETS,
  MAX_ARP_OCTAVES,
  MAX_ARP_VELOCITY_STEPS,
  MIN_ARP_GATE,
  MIN_ARP_VELOCITY_STEPS,
  type ArpVelocity,
  type TrackArp,
} from "../model/arp";

type Patch = Partial<Omit<TrackArp, "velocity">> & { velocity?: Partial<ArpVelocity> };

interface Props {
  arp: TrackArp;
  /** Notes this track has in the shown pattern: with none, the arp has nothing to play. */
  noteCount: number;
  onChange: (patch: Patch) => void;
}

const VEL_MODES: { id: ArpVelocity["mode"]; label: string; title: string }[] = [
  { id: "source", label: "Source", title: "Generated notes keep the velocity of the note they play inside" },
  { id: "pattern", label: "Pattern", title: "Generated notes follow the step levels below" },
  { id: "accent", label: "Accent", title: "The step levels only ever turn the note's velocity down" },
];

/** The step-level editor: one bar per step, drag across them to draw a pattern. Levels are shown
 * 0-127 under each bar. */
function VelocitySteps({ steps, disabled, onChange }: { steps: number[]; disabled: boolean; onChange: (steps: number[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const paint = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || disabled) return;
    const rect = el.getBoundingClientRect();
    const index = Math.min(steps.length - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * steps.length)));
    const level = Math.round(Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height)) * 100) / 100;
    if (steps[index] !== level) onChange(steps.map((s, i) => (i === index ? level : s)));
  };
  return (
    <div
      className="arp-steps"
      ref={ref}
      role="group"
      aria-label="Arp velocity steps"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        paint(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && paint(e)}
    >
      {steps.map((level, i) => (
        <div key={i} className="arp-step">
          <div className="arp-step-bar">
            <div className="arp-step-fill" style={{ height: `${level * 100}%` }} />
          </div>
          <span className="arp-step-value">{Math.round(level * 127)}</span>
        </div>
      ))}
    </div>
  );
}

/** The Arp section of the Track Editor. The arp reads this track's notes bar by bar (their pitches
 * are the chord, their lengths the windows it plays in) and replaces them with generated notes at
 * playback; the notes themselves are never changed. */
export function ArpPanel({ arp, noteCount, onChange }: Props) {
  const v = arp.velocity;
  const setSteps = (steps: number[]) => onChange({ velocity: { steps } });
  const lengthDelta = (d: number) => {
    const n = Math.min(MAX_ARP_VELOCITY_STEPS, Math.max(MIN_ARP_VELOCITY_STEPS, v.steps.length + d));
    if (n === v.steps.length) return;
    setSteps(n < v.steps.length ? v.steps.slice(0, n) : [...v.steps, ...Array.from({ length: n - v.steps.length }, (_, i) => v.steps[i % v.steps.length])]);
  };

  return (
    <div className="arp-panel">
      <div className="arp-head">
        <span className="mod-slot-title">Arp</span>
        <div className="enum-toggle arp-onoff">
          <button className={arp.enabled ? "active" : ""} onClick={() => onChange({ enabled: true })}>
            On
          </button>
          <button className={arp.enabled ? "" : "active"} onClick={() => onChange({ enabled: false })}>
            Off
          </button>
        </div>
        <span className="arp-hint">
          {arp.enabled
            ? noteCount === 0
              ? "Add steps: their pitches are the chord, their lengths the gate"
              : "Plays this track's steps, bar by bar"
            : "Off: steps play as written"}
        </span>
      </div>
      <div className={`module-params arp-params${arp.enabled ? "" : " track-lfo-off"}`}>
        <div className="module-param">
          <span className="param-label static">Order</span>
          <select value={arp.mode} onChange={(e) => onChange({ mode: e.target.value as TrackArp["mode"] })} aria-label="Arp order">
            {ARP_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {arp.mode === "pattern" && (
          <div className="module-param">
            <span className="param-label static">Pattern</span>
            <select value={arp.pattern} onChange={(e) => onChange({ pattern: e.target.value })} aria-label="Arp pattern" title="Index into the chord, low to high. · is a rest.">
              {ARP_PATTERNS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="module-param">
          <span className="param-label static">Rate</span>
          <select value={arp.rate} onChange={(e) => onChange({ rate: e.target.value })} aria-label="Arp rate">
            {ARP_RATES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="module-param">
          <span className="param-label static">Octaves</span>
          <div className="enum-toggle">
            {Array.from({ length: MAX_ARP_OCTAVES }, (_, i) => i + 1).map((o) => (
              <button key={o} className={o === arp.octaves ? "active" : ""} onClick={() => onChange({ octaves: o })}>
                {o}
              </button>
            ))}
          </div>
        </div>
        <div className="module-param">
          <span className="param-label static">Gate</span>
          <div className="range-row">
            <input
              type="range"
              min={Math.round(MIN_ARP_GATE * 100)}
              max={100}
              step={5}
              value={Math.round(arp.gate * 100)}
              onChange={(e) => onChange({ gate: Number(e.target.value) / 100 })}
              aria-label="Arp gate"
            />
            <span className="value">{Math.round(arp.gate * 100)}%</span>
          </div>
        </div>
      </div>
      <div className={`module-params arp-params${arp.enabled ? "" : " track-lfo-off"}`}>
        <div className="module-param">
          <span className="param-label static">Velocity</span>
          <div className="enum-toggle">
            {VEL_MODES.map((m) => (
              <button key={m.id} className={m.id === v.mode ? "active" : ""} title={m.title} onClick={() => onChange({ velocity: { mode: m.id } })}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {v.mode !== "source" && (
          <>
            <div className="module-param">
              <span className="param-label static">Amount</span>
              <div className="range-row">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(v.amount * 100)}
                  onChange={(e) => onChange({ velocity: { amount: Number(e.target.value) / 100 } })}
                  aria-label="Arp velocity amount"
                />
                <span className="value">{Math.round(v.amount * 100)}%</span>
              </div>
            </div>
            <div className="module-param arp-steps-param">
              <span className="param-label static">Steps</span>
              <VelocitySteps steps={v.steps} disabled={!arp.enabled} onChange={setSteps} />
              <div className="arp-steps-tools">
                <button className="btn small" onClick={() => lengthDelta(-1)} disabled={v.steps.length <= MIN_ARP_VELOCITY_STEPS} aria-label="Fewer velocity steps">
                  −
                </button>
                <span className="value">{v.steps.length}</span>
                <button className="btn small" onClick={() => lengthDelta(1)} disabled={v.steps.length >= MAX_ARP_VELOCITY_STEPS} aria-label="More velocity steps">
                  +
                </button>
                <select
                  value=""
                  onChange={(e) => {
                    const preset = ARP_VELOCITY_PRESETS.find((p) => p.id === e.target.value);
                    if (preset) setSteps([...preset.steps]);
                  }}
                  aria-label="Velocity step preset"
                >
                  <option value="">Preset…</option>
                  {ARP_VELOCITY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
