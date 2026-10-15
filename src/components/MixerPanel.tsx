import { MAX_TRACK_VOLUME, MIN_TRACK_VOLUME } from "../model/project";
import type { Track, TrackId } from "../model/types";
import { effectivePan, trackHasSource } from "../model/types";

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
  onSetPan: (trackId: TrackId, pan: number) => void;
}

function panLabel(pan: number): string {
  if (Math.abs(pan) < 0.005) return "C";
  return `${pan < 0 ? "L" : "R"}${Math.round(Math.abs(pan) * 100)}`;
}

/** A small per-track control surface below the timeline (see App.tsx's FX/Mixer tab switch):
 * one vertical channel strip per track, laid out in a row and scrolled horizontally as a whole
 * — same track list/order as the timeline and the FX rack (for the active bank), just a fader-strip layout instead
 * of a row-per-track one, to avoid the dead horizontal space a full-width row layout leaves
 * once there's nothing but a slider and two buttons on it. Volume changes reach the engine
 * immediately (App.tsx's existing FX-push effect, reused verbatim for NodeParam.BusGain — see
 * src/audio/mixer.ts), not on any sequencer tick. Each strip also has a pan control (the bus's
 * NodeParam.BusPan). VU meters are still absent: webdsp has no metering API. */
export function MixerPanel({ tracks, trackNumberOffset, onSetVolume, onSetMuted, onSetSoloed, onSetPan }: Props) {
  return (
    <div className="mixer-panel">
      {tracks.map((track, i) => (
        <div key={track.id} className={`mixer-strip ${track.muted ? "muted" : ""}`}>
          <span className="mixer-strip-num">{String(trackNumberOffset + i + 1).padStart(2, "0")}</span>
          <span
            className={`mixer-strip-name ${trackHasSource(track) ? "" : "unassigned"}`}
            title={trackHasSource(track) ? track.name : undefined}
          >
            {trackHasSource(track) ? track.name : "—"}
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
          <div className="mixer-pan">
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={effectivePan(track)}
              onChange={(e) => onSetPan(track.id, Number(e.target.value))}
              onDoubleClick={() => onSetPan(track.id, 0)}
              aria-label={`${track.name} pan`}
              title="Pan (double-click to centre)"
            />
            <span className="mixer-strip-value">{panLabel(effectivePan(track))}</span>
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
