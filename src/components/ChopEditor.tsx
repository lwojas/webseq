import { useCallback, useEffect, useRef, useState } from "react";
import { addCue, evenCues, MAX_SLICES, moveCue, removeCue } from "../model/chop";
import { loadPeaks } from "../audio/peaks";
import type { Asset } from "../model/types";

interface Props {
  asset: Asset;
  /** The asset's original bytes, for drawing the waveform (undefined if unavailable). */
  getAssetBytes: (assetId: number) => ArrayBuffer | undefined;
  onSetCues: (assetId: number, cues: number[]) => void;
  onAuditionSlice: (assetId: number, slice: number) => void;
}

const EVEN_SPLITS = [2, 4, 8, 16, 32];
const NUDGE = 0.005;

/** Waveform with draggable cue points. Slices are contiguous: N cues make N+1 slices, numbered
 * 1..N+1 — a chop track's note pitch 0 plays slice 1, pitch 1 slice 2, and so on. Tap empty
 * waveform to add a cue, drag a cue to move it, select one and press Remove (or Delete) to drop
 * it. Drags preview locally and commit once on release, so the engine is updated once. */
export function ChopEditor({ asset, getAssetBytes, onSetCues, onAuditionSlice }: Props) {
  const cues = asset.cues ?? [];
  const [draft, setDraft] = useState<number[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ index: number; moved: boolean } | null>(null);
  const shown = draft ?? cues;

  useEffect(() => {
    let live = true;
    setPeaks(undefined);
    void loadPeaks(asset.id, () => getAssetBytes(asset.id)).then((p) => live && setPeaks(p));
    return () => {
      live = false;
    };
  }, [asset.id, getAssetBytes]);

  useEffect(() => setSelected(null), [asset.id]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx || !peaks) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = getComputedStyle(wrap).getPropertyValue("--accent").trim() || "currentColor";
    const mid = h / 2;
    for (let x = 0; x < w; x++) {
      const p = peaks[Math.min(peaks.length - 1, Math.floor((x / w) * peaks.length))];
      const half = Math.max(0.5, p * mid);
      ctx.fillRect(x, mid - half, 1, half * 2);
    }
  }, [peaks]);

  useEffect(() => {
    draw();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  const fractionAt = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onCuePointerDown = (index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { index, moved: false };
    setSelected(index);
  };
  const onCuePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.moved = true;
    setDraft(moveCue(draft ?? cues, drag.index, fractionAt(e.clientX)));
  };
  const onCuePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved && draft) onSetCues(asset.id, draft);
    setDraft(null);
  };
  const onCueKeyDown = (index: number) => (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onSetCues(asset.id, moveCue(cues, index, cues[index] + (e.key === "ArrowLeft" ? -NUDGE : NUDGE)));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onSetCues(asset.id, removeCue(cues, index));
      setSelected(null);
    }
  };
  const onWaveformPointerDown = (e: React.PointerEvent) => {
    const next = addCue(cues, fractionAt(e.clientX));
    if (next.length === cues.length) return;
    onSetCues(asset.id, next);
    setSelected(next.findIndex((c) => !cues.includes(c)));
  };

  const sliceBounds = [0, ...shown, 1];
  const atMax = shown.length + 1 >= MAX_SLICES;

  return (
    <div className="chop-editor">
      <div className="chop-toolbar">
        <span className="track-mode-label">Slices</span>
        <div className="track-mode-toggle">
          {EVEN_SPLITS.map((n) => (
            <button key={n} className={cues.length + 1 === n ? "active" : ""} onClick={() => onSetCues(asset.id, evenCues(n))} title={`Split evenly into ${n} slices`}>
              {n}
            </button>
          ))}
        </div>
        <button
          className="btn small"
          disabled={selected === null || selected >= cues.length}
          onClick={() => {
            if (selected === null) return;
            onSetCues(asset.id, removeCue(cues, selected));
            setSelected(null);
          }}
          title="Remove the selected cue point"
        >
          Remove cue
        </button>
        <button className="btn small" disabled={cues.length === 0} onClick={() => onSetCues(asset.id, [])} title="Remove all cue points">
          Clear
        </button>
      </div>
      <div ref={wrapRef} className="chop-wave" onPointerDown={atMax ? undefined : onWaveformPointerDown}>
        <canvas ref={canvasRef} />
        {peaks === null && <span className="chop-wave-empty">Waveform unavailable</span>}
        {sliceBounds.slice(0, -1).map((from, i) => (
          <span key={i} className="chop-slice-label" style={{ left: `${from * 100}%`, width: `${(sliceBounds[i + 1] - from) * 100}%` }}>
            {i + 1}
          </span>
        ))}
        {shown.map((cue, i) => (
          <div
            key={i}
            className={`chop-cue ${selected === i ? "selected" : ""}`}
            style={{ left: `${cue * 100}%` }}
            role="slider"
            tabIndex={0}
            aria-label={`Cue point ${i + 1}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(cue * 100)}
            onPointerDown={onCuePointerDown(i)}
            onPointerMove={onCuePointerMove}
            onPointerUp={onCuePointerUp}
            onPointerCancel={onCuePointerUp}
            onKeyDown={onCueKeyDown(i)}
            onFocus={() => setSelected(i)}
          />
        ))}
      </div>
      <div className="chop-pads" role="group" aria-label="Audition slices">
        {sliceBounds.slice(0, -1).map((_, i) => (
          <button key={i} className="chop-pad" onPointerDown={() => onAuditionSlice(asset.id, i)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onAuditionSlice(asset.id, i)}
            title={`Play slice ${i + 1}`}>
            {i + 1}
          </button>
        ))}
      </div>
      <div className="instrument-hint">
        {cues.length === 0
          ? "Tap the waveform to add cue points, or pick an even split."
          : `${cues.length + 1} slices. In a chop track a step's pitch picks the slice: 0 = slice 1, +1 = slice 2, ...`}
      </div>
    </div>
  );
}
