import { MAX_TEMPO, MIN_TEMPO } from "../model/pattern";
import type { PlaybackStatus } from "../audio/transport";
import { useRafText } from "../hooks/useRafText";

interface Props {
  status: PlaybackStatus;
  tempo: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onTempoChange: (tempo: number) => void;
  getPositionText: () => string;
}

export function TransportBar({ status, tempo, onPlay, onPause, onStop, onTempoChange, getPositionText }: Props) {
  const positionRef = useRafText(getPositionText);

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
          min={MIN_TEMPO}
          max={MAX_TEMPO}
          value={tempo}
          onChange={(e) => onTempoChange(Number(e.target.value))}
        />
        <input
          type="number"
          min={MIN_TEMPO}
          max={MAX_TEMPO}
          value={tempo}
          onChange={(e) => onTempoChange(Number(e.target.value))}
        />
      </div>

      <span className="position-readout" ref={positionRef} />

      <div className="spacer" />
    </div>
  );
}
