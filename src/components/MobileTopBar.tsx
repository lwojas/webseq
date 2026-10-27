import type { Pattern, PatternId } from "../model/types";
import type { PlaybackStatus } from "../audio/transport";

interface Props {
  status: PlaybackStatus;
  onPlay: () => void;
  onStop: () => void;
  patterns: Pattern[];
  selectedPatternId: PatternId;
  bpm: number;
  pickerOpen: boolean;
  settingsOpen: boolean;
  onStep: (direction: -1 | 1) => void;
  onTogglePicker: () => void;
  onToggleSettings: () => void;
  /** The Timeline tab shows the Composer instead of the grid; the chip flips between the two. */
  composerOpen: boolean;
  onToggleComposer: () => void;
}

/** The phone's only top chrome: ONE fixed 44px row that never wraps, whatever the pattern count.
 * Play/stop toggle · ◀ pattern ▾ ▶ · bars (opens the picker, which has the stepper) · BPM (opens
 * Settings) · ⋯ (Settings: project, swing, grid, zoom, resample). Mounted only on the Timeline tab
 * of a phone-width viewport (see App.tsx). */
export function MobileTopBar({ status, onPlay, onStop, patterns, selectedPatternId, bpm, pickerOpen, settingsOpen, onStep, onTogglePicker, onToggleSettings, composerOpen, onToggleComposer }: Props) {
  const index = patterns.findIndex((p) => p.id === selectedPatternId);
  const selected = patterns[index] ?? patterns[0];
  const playing = status === "playing";

  return (
    <div className="mobile-topbar">
      <button
        className={`btn mobile-topbar-play ${playing ? "active" : ""}`}
        onClick={playing ? onStop : onPlay}
        aria-label={playing ? "Stop" : "Play"}
      >
        {playing ? "■" : "▶"}
      </button>
      <button className="btn pattern-step" onClick={() => onStep(-1)} disabled={index <= 0} aria-label="Previous pattern">
        ◀
      </button>
      <button className={`pattern-strip-name ${pickerOpen ? "open" : ""}`} onClick={onTogglePicker} aria-expanded={pickerOpen} aria-label="Choose pattern">
        <span className="pattern-strip-name-text">{selected?.name}</span>
        <span aria-hidden="true">{pickerOpen ? "▴" : "▾"}</span>
      </button>
      <button className="btn pattern-step" onClick={() => onStep(1)} disabled={index >= patterns.length - 1} aria-label="Next pattern">
        ▶
      </button>
      <button className="btn mobile-topbar-chip" onClick={onTogglePicker} aria-label="Pattern length — open pattern picker">
        {selected?.bars} bar
      </button>
      <button className={`btn mobile-topbar-chip ${composerOpen ? "active" : ""}`} onClick={onToggleComposer} aria-pressed={composerOpen} aria-label={composerOpen ? "Back to the sequencer grid" : "Open the Composer"}>
        {composerOpen ? "Grid" : "Song"}
      </button>
      <button className="btn mobile-topbar-chip" onClick={onToggleSettings} aria-label="Tempo — open settings">
        {bpm}
      </button>
      <button className={`btn mobile-topbar-chip ${settingsOpen ? "active" : ""}`} onClick={onToggleSettings} aria-expanded={settingsOpen} aria-label="Settings">
        {settingsOpen ? "✕" : "⋯"}
      </button>
    </div>
  );
}
