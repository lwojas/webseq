import { useCallback, useEffect, useState } from "react";
import { MAX_BPM, MAX_SWING, MIN_BPM, MIN_SWING } from "../model/project";
import type { GridResolution } from "../model/notes";
import type { PlaybackStatus, ResampleStatus } from "../audio/transport";
import { useRafText } from "../hooks/useRafText";
import { formatScale, type ProjectScale } from "../model/scale";
import type { PlaybackSource } from "../model/composer";
import { ScaleControl } from "./ScaleControl";
import { GridZoomControls } from "./GridZoomControls";

export type ResamplePhase = "idle" | "pending" | "processing" | "complete" | "error";

interface Props {
  status: PlaybackStatus;
  bpm: number;
  /** The host tempo while the transport follows an external clock; the tempo then belongs to the host, so
   * the control shows it and is read-only. Null when playing on our own. */
  followedBpm?: number | null;
  swing: number;
  gridResolution: GridResolution;
  scale: ProjectScale;
  onScaleChange: (patch: Partial<ProjectScale>) => void;
  onOpenGuide: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onBpmChange: (bpm: number) => void;
  onSwingChange: (swing: number) => void;
  onGridResolutionChange: (resolution: GridResolution) => void;
  /** Timeline zoom (see GridZoomControls). */
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  getPositionText: () => string;
  /** What Play plays: the launcher's pattern queue or the Composer song. */
  source: PlaybackSource;
  onSourceChange: (source: PlaybackSource) => void;
  canResample: boolean;
  onResample: () => void;
  resamplePhase: ResamplePhase;
  resampleError: string | null;
  /** Live ARMED/CAPTURING label while `resamplePhase === "pending"` — read from
   * Transport.getResampleStatus() each frame the same way getPositionText already reads the
   * playhead, so this reflects the actual engine-armed state, not just "a click happened". */
  getResampleLabel: () => ResampleStatus;
  /** "bar" (default): the desktop transport row, play buttons first; scale lives in a contextual
   * menu and grid/zoom in the pattern strip. "settings": the phone's ⋯ Settings view — the
   * tempo/swing/scale/grid/zoom/resample fields inline, no play buttons (the phone top bar owns
   * play/stop) and no position readout. */
  variant?: "bar" | "settings";
}

export function TransportBar({
  status,
  bpm: projectBpm,
  followedBpm = null,
  swing,
  gridResolution,
  scale,
  onScaleChange,
  onOpenGuide,
  onPlay,
  onPause,
  onStop,
  onBpmChange,
  onSwingChange,
  onGridResolutionChange,
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  getPositionText,
  source,
  onSourceChange,
  canResample,
  onResample,
  resamplePhase,
  resampleError,
  getResampleLabel,
  variant = "bar",
}: Props) {
  const positionRef = useRafText(getPositionText);
  // A stable getter: an inline arrow would restart the per-frame loop on every render.
  const getResampleText = useCallback(() => getResampleLabel().toUpperCase(), [getResampleLabel]);
  const resampleLiveRef = useRafText(getResampleText);
  const bpm = followedBpm ?? projectBpm;
  const [scaleOpen, setScaleOpen] = useState(false);
  useEffect(() => {
    if (!scaleOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setScaleOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scaleOpen]);
  const bpmDisabled = resamplePhase === "pending" || resamplePhase === "processing" || followedBpm !== null;

  return (
    <div className={`transport ${variant === "settings" ? "transport-settings" : ""}`}>
      {variant === "bar" && (
        <div className="transport-buttons">
          <button
            className={`btn transport-play ${status === "playing" ? "active" : ""}`}
            onClick={status === "playing" ? onPause : onPlay}
            title={status === "playing" ? "Pause  [Space stops]" : status === "paused" ? "Resume" : "Play  [Space]"}
          >
            {status === "playing" ? "❙❙ Pause" : "▶ Play"}
          </button>
          <button className="btn danger" onClick={onStop} disabled={status === "stopped"} title="Stop and return to the start">
            ■ Stop
          </button>
        </div>
      )}

      <div className="source-toggle" role="group" aria-label="Playback source">
        {(["pattern", "song"] as const).map((id) => (
          <button
            key={id}
            className={`btn small ${source === id ? "active" : ""}`}
            aria-pressed={source === id}
            title={id === "pattern" ? "Play the pattern queue (the launcher)" : "Play the Composer timeline, left to right"}
            onClick={() => source !== id && onSourceChange(id)}
          >
            {id === "pattern" ? "Pattern" : "Song"}
          </button>
        ))}
      </div>

      <div className="field">
        <span>{followedBpm !== null ? "BPM · host" : "BPM"}</span>
        <input
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          value={bpm}
          disabled={bpmDisabled}
          onChange={(e) => onBpmChange(Number(e.target.value))}
        />
        <input
          type="number"
          min={MIN_BPM}
          max={MAX_BPM}
          value={bpm}
          disabled={bpmDisabled}
          onChange={(e) => onBpmChange(Number(e.target.value))}
        />
      </div>

      <div className="field">
        <span>Swing</span>
        <input
          type="range"
          min={MIN_SWING * 100}
          max={MAX_SWING * 100}
          value={Math.round(swing * 100)}
          disabled={bpmDisabled}
          onChange={(e) => onSwingChange(Number(e.target.value) / 100)}
        />
        <span>{Math.round(swing * 100)}%</span>
      </div>

      {variant === "bar" ? (
        <div className="scale-menu">
          <button
            className={`btn ${scaleOpen ? "active" : ""}`}
            onClick={() => setScaleOpen(!scaleOpen)}
            aria-expanded={scaleOpen}
            title={`Key: ${formatScale(scale)} — open the scale controls`}
          >
            Scales · {formatScale(scale)}
          </button>
          {scaleOpen && (
            <div className="transport-popover" role="dialog" aria-label="Scales">
              <div className="transport-popover-head">
                <span className="transport-popover-title">Scales</span>
                <button className="transport-popover-close" onClick={() => setScaleOpen(false)} aria-label="Close scales menu">
                  ✕
                </button>
              </div>
              <ScaleControl
                scale={scale}
                onChange={onScaleChange}
                onOpenGuide={() => {
                  setScaleOpen(false);
                  onOpenGuide();
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <ScaleControl scale={scale} onChange={onScaleChange} onOpenGuide={onOpenGuide} />
          <GridZoomControls
            gridResolution={gridResolution}
            onGridResolutionChange={onGridResolutionChange}
            zoomPercent={zoomPercent}
            canZoomIn={canZoomIn}
            canZoomOut={canZoomOut}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
          />
        </>
      )}

      {variant === "bar" && <span className="position-readout" ref={positionRef} />}

      <div className="resample-control">
        <button
          className={`btn resample-btn ${resamplePhase !== "idle" ? "active" : ""}`}
          onClick={onResample}
          disabled={!canResample}
          title={canResample ? "Resample one iteration of the currently playing pattern" : "Play a pattern first"}
        >
          Resample
        </button>
        {resamplePhase === "pending" && <span className="resample-status" ref={resampleLiveRef} />}
        {resamplePhase === "processing" && <span className="resample-status">PROCESSING</span>}
        {resamplePhase === "complete" && <span className="resample-status complete">COMPLETE</span>}
        {resamplePhase === "error" && (
          <span className="resample-status error" title={resampleError ?? undefined}>
            ERROR
          </span>
        )}
      </div>

      <div className="spacer" />
    </div>
  );
}
