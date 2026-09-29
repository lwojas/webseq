import { MAX_BPM, MIN_BPM } from "../model/project";
import type { PlaybackStatus, ResampleStatus } from "../audio/transport";
import { useRafText } from "../hooks/useRafText";

export type ResamplePhase = "idle" | "pending" | "processing" | "complete" | "error";

interface Props {
  status: PlaybackStatus;
  bpm: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onBpmChange: (bpm: number) => void;
  getPositionText: () => string;
  canResample: boolean;
  onResample: () => void;
  resamplePhase: ResamplePhase;
  resampleError: string | null;
  /** Live ARMED/CAPTURING label while `resamplePhase === "pending"` — read from
   * Transport.getResampleStatus() each frame the same way getPositionText already reads the
   * playhead, so this reflects the actual engine-armed state, not just "a click happened". */
  getResampleLabel: () => ResampleStatus;
}

export function TransportBar({
  status,
  bpm,
  onPlay,
  onPause,
  onStop,
  onBpmChange,
  getPositionText,
  canResample,
  onResample,
  resamplePhase,
  resampleError,
  getResampleLabel,
}: Props) {
  const positionRef = useRafText(getPositionText);
  const resampleLiveRef = useRafText(() => getResampleLabel().toUpperCase());
  const bpmDisabled = resamplePhase === "pending" || resamplePhase === "processing";

  return (
    <div className="transport">
      <div className="transport-buttons">
        <button className={`btn ${status === "playing" ? "active" : ""}`} onClick={onPlay}>
          ▶ Play
        </button>
        <button className={`btn ${status === "paused" ? "active" : ""}`} onClick={onPause}>
          ❙❙ Pause
        </button>
        <button className={`btn danger ${status === "stopped" ? "active" : ""}`} onClick={onStop}>
          ■ Stop
        </button>
      </div>

      <div className="field">
        <span>BPM</span>
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

      <span className="position-readout" ref={positionRef} />

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
