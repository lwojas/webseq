import { useEffect, useMemo, useRef, useState } from "react";
import { EQ_MAX_HZ, EQ_MIN_HZ, eqBandResponseDb, eqBandUses, eqCurve } from "webdsp";
import { useSpectrumCanvas, type SpectrumTap } from "../viz/useSpectrumCanvas";
import { EQ_VIEW_DB, bandsFromParams, dbToY, freqToX, handleDb, widenedValue, widthParam, xToFreq, yToDb } from "../model/eqGeometry";

const W = 640;
const H = 190;
const POINTS = 192;
const SAMPLE_RATE = 48000; // the curve's shape barely depends on it; only the top octave does
const BAND_COLORS = ["#29e0e0", "#f0a83c", "#9be36b", "#e07ab8"];
const TYPE_NAMES = ["Bell", "Low shelf", "High shelf", "Low-pass", "High-pass", "Notch"];
const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

// Live input spectrum behind the curve: its own dB scale (dBFS), independent of the EQ's +-dB axis.
const SPECTRUM_MIN_DB = -90;
const SPECTRUM_MAX_DB = -10;

interface Props {
  params: Record<string, number>;
  /** Where to take the live spectrum from (the engine effect's input); omit for no spectrum. */
  spectrumTap?: () => SpectrumTap | null;
  /** Changes when the tapped effect changes, so the display re-attaches. */
  spectrumKey?: string;
  onSetParam: (paramId: string, value: number) => void;
}

/** Interactive EQ: the response curve is the control surface. Drag a handle = frequency (x) and
 * gain (y); wheel or shift+vertical drag = Q (bell/notch) or slope (shelves); double-click =
 * enable/disable. Exact values for the selected band sit under the graph. */
export function EqCurveEditor({ params, onSetParam, spectrumTap, spectrumKey = "" }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const spectrumRef = useRef<HTMLCanvasElement>(null);
  useSpectrumCanvas(spectrumRef, () => spectrumTap?.() ?? null, spectrumKey, {
    width: W, height: H, minDb: SPECTRUM_MIN_DB, maxDb: SPECTRUM_MAX_DB,
    fill: "rgba(160, 190, 220, 0.16)", stroke: "rgba(160, 190, 220, 0.5)",
  });
  const [selected, setSelected] = useState(1);
  const wasOnAtFirstClick = useRef(false);
  const lastDown = useRef({ band: -1, at: 0 });
  const drag = useRef<{ band: number; startY: number; startWidth: number; width: boolean } | null>(null);
  const bands = useMemo(() => bandsFromParams(params), [params]);
  const curve = useMemo(() => eqCurve(bands, SAMPLE_RATE, POINTS), [bands]);

  const path = (db: Float64Array) =>
    Array.from(db, (v, i) => `${i ? "L" : "M"}${freqToX(curve.frequencies[i], W).toFixed(1)},${dbToY(v, H).toFixed(1)}`).join("");
  const set = (band: number, field: string, v: number) => onSetParam(`b${band + 1}${field}`, v);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const onDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setSelected(i);
    // PointerEvent.detail is always 0, so a double-click is recognised by timing: remember whether the
    // band was on before the FIRST press (the press itself enables an off band).
    const now = e.timeStamp;
    if (lastDown.current.band !== i || now - lastDown.current.at > 500) wasOnAtFirstClick.current = bands[i].enabled;
    lastDown.current = { band: i, at: now };
    if (!bands[i].enabled) set(i, "On", 1);
    const wp = widthParam(bands[i].type);
    drag.current = { band: i, startY: e.clientY, startWidth: wp ? bands[i][wp] : 0, width: e.shiftKey };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const b = bands[d.band];
    const p = local(e);
    if (d.width) {
      const wp = widthParam(b.type);
      if (wp) set(d.band, wp === "q" ? "Q" : "ShelfSlope", widenedValue(b.type, d.startWidth, (e.clientY - d.startY) / 60));
      return;
    }
    set(d.band, "Freq", Math.round(xToFreq(p.x, W)));
    if (eqBandUses(b.type, "gain")) set(d.band, "Gain", Math.round(yToDb(p.y, H) * 10) / 10);
  };
  const onUp = () => {
    drag.current = null;
  };
  // Wheel over a handle edits its width. React's onWheel is passive (cannot stop the page scrolling), so this is a
  // native non-passive listener that reads the latest bands through a ref.
  const latest = useRef({ bands, set });
  latest.current = { bands, set };
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      const i = Number((e.target as SVGElement | null)?.dataset?.band);
      if (!Number.isInteger(i)) return;
      const { bands: bs, set: setParam } = latest.current;
      const wp = widthParam(bs[i].type);
      if (!wp) return;
      e.preventDefault();
      setParam(i, wp === "q" ? "Q" : "ShelfSlope", widenedValue(bs[i].type, bs[i][wp], -e.deltaY / 300));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const sel = bands[selected];
  const num = (label: string, field: string, value: number, min: number, max: number, step: number, unit = "") => (
    <label className="eq-field" key={field}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(selected, field, Number(e.target.value))} />
      <span className="value">{value < 10 ? value.toFixed(2) : Math.round(value)}{unit}</span>
    </label>
  );

  return (
    <div className="eq-editor">
      <div className="eq-main">
      <div className="eq-graph-wrap">
      <canvas ref={spectrumRef} className="eq-spectrum" aria-hidden="true" />
      <svg ref={svgRef} className="eq-graph" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="EQ frequency response" onPointerMove={onMove} onPointerUp={onUp}>
        {[-12, -6, 0, 6, 12].map((db) => (
          <g key={db}>
            <line className={db === 0 ? "eq-zero" : "eq-grid"} x1={0} x2={W} y1={dbToY(db, H)} y2={dbToY(db, H)} />
            <text className="eq-label" x={3} y={dbToY(db, H) - 2}>{db > 0 ? `+${db}` : db}</text>
          </g>
        ))}
        {GRID_HZ.map((hz) => (
          <g key={hz}>
            <line className="eq-grid" x1={freqToX(hz, W)} x2={freqToX(hz, W)} y1={0} y2={H} />
            <text className="eq-label" x={freqToX(hz, W) + 2} y={H - 3}>{hz >= 1000 ? `${hz / 1000}k` : hz}</text>
          </g>
        ))}
        {bands.map((b, i) =>
          b.enabled ? (
            <path key={i} d={`${path(curve.bandDb[i])}L${W},${dbToY(0, H)}L0,${dbToY(0, H)}Z`} fill={BAND_COLORS[i]} fillOpacity={selected === i ? 0.22 : 0.1} stroke="none" />
          ) : null,
        )}
        <path className="eq-curve" d={path(curve.combinedDb)} />
        {bands.map((b, i) => (
          <circle
            key={i}
            className={`eq-handle ${b.enabled ? "on" : "off"} ${selected === i ? "selected" : ""}`}
            cx={freqToX(b.frequency, W)}
            cy={dbToY(handleDb(b), H)}
            r={selected === i ? 9 : 7}
            stroke={BAND_COLORS[i]}
            fill={b.enabled ? BAND_COLORS[i] : "transparent"}
            onPointerDown={onDown(i)}
            data-band={i}
            onDoubleClick={() => set(i, "On", wasOnAtFirstClick.current ? 0 : 1)}
          >
            <title>{`Band ${i + 1} ${TYPE_NAMES[b.type]} ${Math.round(b.frequency)} Hz`}</title>
          </circle>
        ))}
        {bands.map((b, i) => (
          <text key={`n${i}`} className="eq-handle-num" x={freqToX(b.frequency, W)} y={dbToY(handleDb(b), H) + 3.5}>{i + 1}</text>
        ))}
      </svg>
      </div>
      <div className="eq-hint">Drag a handle: frequency / gain. Wheel or shift-drag: Q / slope. Double-click: on/off. Range +-{EQ_VIEW_DB} dB, {EQ_MIN_HZ} Hz to {EQ_MAX_HZ / 1000} kHz.</div>
      </div>
      <div className="eq-band-panel" style={{ borderColor: BAND_COLORS[selected] }}>
        <div className="eq-band-head">
          {bands.map((_, i) => (
            <button key={i} className={selected === i ? "active" : ""} onClick={() => setSelected(i)} style={{ borderColor: BAND_COLORS[i] }}>
              {i + 1}
            </button>
          ))}
          <button className={sel.enabled ? "active" : ""} onClick={() => set(selected, "On", sel.enabled ? 0 : 1)}>{sel.enabled ? "On" : "Off"}</button>
          <select className="fx-add-select" value={sel.type} onChange={(e) => set(selected, "Type", Number(e.target.value))} aria-label="Band type">
            {TYPE_NAMES.map((n, v) => <option key={v} value={v}>{n}</option>)}
          </select>
          <span className="eq-readout">
            {Math.round(sel.frequency)} Hz{eqBandUses(sel.type, "gain") ? `, ${sel.gain.toFixed(1)} dB` : ""}
            {sel.enabled ? ` (${eqBandResponseDb(sel, sel.frequency, SAMPLE_RATE).toFixed(1)} dB at centre)` : ""}
          </span>
        </div>
        <div className="eq-fields">
          {num("Freq", "Freq", sel.frequency, 20, 20000, 1, "Hz")}
          {eqBandUses(sel.type, "gain") && num("Gain", "Gain", sel.gain, -18, 18, 0.1, "dB")}
          {eqBandUses(sel.type, "q") && num("Q", "Q", sel.q, 0.1, 18, 0.01)}
          {eqBandUses(sel.type, "shelfSlope") && num("Slope", "ShelfSlope", sel.shelfSlope, 0.1, 1, 0.01)}
          {eqBandUses(sel.type, "slope") && (
            <label className="eq-field">
              <span>Slope</span>
              <span className="enum-toggle">
                {[12, 24].map((s) => (
                  <button key={s} className={sel.slope === s ? "active" : ""} onClick={() => set(selected, "Slope", s)}>{s} dB/oct</button>
                ))}
              </span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
