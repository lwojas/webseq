import type { Track, TrackId } from "../model/types";

interface Props {
  /** The selected track, or null for MASTER / nothing selected. */
  track: Track | null;
  /** Positional label, e.g. "01 · Kick" or "MASTER". */
  label: string;
  canPrev: boolean;
  canNext: boolean;
  onStep: (direction: -1 | 1) => void;
  onSetMuted: (trackId: TrackId, muted: boolean) => void;
  onSetSoloed: (trackId: TrackId, soloed: boolean) => void;
  /** Global play/stop, so you can audition while tuning without leaving the tab. */
  playing: boolean;
  onTogglePlay: () => void;
}

/** The phone Track tab's 44px bar: play, ◀ track ▶, M, S. It answers "which track am I editing, and
 * can I step to the next one" above the Inst / FX / Notes / Edit sub-tabs. Every value comes
 * straight from the Track, so there is nothing to keep in sync. */
export function TrackHeaderBar({ track, label, canPrev, canNext, onStep, onSetMuted, onSetSoloed, playing, onTogglePlay }: Props) {
  return (
    <div className="track-head">
      <button className={`btn track-head-play ${playing ? "active" : ""}`} onClick={onTogglePlay} aria-label={playing ? "Stop" : "Play"}>
        {playing ? "■" : "▶"}
      </button>
      <button className="btn small track-head-step" onClick={() => onStep(-1)} disabled={!canPrev} aria-label="Previous track">
        ◀
      </button>
      <span className="track-head-label" title={track?.name}>
        {label}
      </span>
      <button className="btn small track-head-step" onClick={() => onStep(1)} disabled={!canNext} aria-label="Next track">
        ▶
      </button>
      {track && (
        <>
          <button
            className={`btn small track-head-toggle ${track.muted ? "active" : ""}`}
            onClick={() => onSetMuted(track.id, !track.muted)}
            aria-pressed={track.muted}
            aria-label={`Mute ${track.name}`}
          >
            M
          </button>
          <button
            className={`btn small track-head-toggle ${track.soloed ? "active" : ""}`}
            onClick={() => onSetSoloed(track.id, !track.soloed)}
            aria-pressed={track.soloed}
            aria-label={`Solo ${track.name}`}
          >
            S
          </button>
        </>
      )}
    </div>
  );
}
