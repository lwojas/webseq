import { MAX_TRACK_VOLUME, MIN_TRACK_VOLUME } from "../model/project";
import type { Track, TrackId } from "../model/types";

interface Props {
  /** The active bank's tracks only (see App.tsx). Bank paging changes which tracks are listed,
   * never their levels: each strip reads and writes its own track's volume. */
  tracks: Track[];
  /** Index of the first track in `tracks` within the whole project, so strips keep their
   * global track numbers (bank B starts at 17). */
  trackNumberOffset: number;
  onSetVolume: (trackId: TrackId, volume: number) => void;
  onSetMuted: (trackId: TrackId, muted: boolean) => void;
  onSetSoloed: (trackId: TrackId, soloed: boolean) => void;
}

/** A small per-track control surface below the timeline (see App.tsx's FX/Mixer tab switch):
 * one vertical channel strip per track, laid out in a row and scrolled horizontally as a whole
 * — same track list/order as the timeline and the FX rack (for the active bank), just a fader-strip layout instead
 * of a row-per-track one, to avoid the dead horizontal space a full-width row layout leaves
 * once there's nothing but a slider and two buttons on it. Volume changes reach the engine
 * immediately (App.tsx's existing FX-push effect, reused verbatim for NodeParam.BusGain — see
 * src/audio/mixer.ts), not on any sequencer tick. Pan and VU meters are intentionally absent:
 * webdsp has no pan primitive and no metering API today (see the discovery assessment) —
 * adding either is an engine change, not a UI one. */
export function MixerPanel({ tracks, trackNumberOffset, onSetVolume, onSetMuted, onSetSoloed }: Props) {
  return (
    <div className="mixer-panel">
      {tracks.map((track, i) => (
        <div key={track.id} className={`mixer-strip ${track.muted ? "muted" : ""}`}>
          <span className="mixer-strip-num">{String(trackNumberOffset + i + 1).padStart(2, "0")}</span>
          <span
            className={`mixer-strip-name ${track.assetId == null ? "unassigned" : ""}`}
            title={track.assetId == null ? undefined : track.name}
          >
            {track.assetId == null ? "—" : track.name}
          </span>
          <span className="mixer-strip-value">{Math.round(track.volume * 100)}%</span>
          <div className="mixer-fader-wrap">
            <input
              type="range"
              className="mixer-fader"
              min={MIN_TRACK_VOLUME}
              max={MAX_TRACK_VOLUME}
              step={0.01}
              value={track.volume}
              onChange={(e) => onSetVolume(track.id, Number(e.target.value))}
              aria-label={`${track.name} volume`}
              aria-orientation="vertical"
            />
          </div>
          <div className="mixer-strip-buttons">
            <button
              className={`btn small mixer-mute ${track.muted ? "active" : ""}`}
              onClick={() => onSetMuted(track.id, !track.muted)}
              title="Mute"
            >
              M
            </button>
            <button
              className={`btn small mixer-solo ${track.soloed ? "active" : ""}`}
              onClick={() => onSetSoloed(track.id, !track.soloed)}
              title="Solo"
            >
              S
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
