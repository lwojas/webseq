import type { Pattern, PatternId } from "../model/types";
import { MAX_PATTERN_BARS } from "../model/notes";
import { RafText } from "./RafText";
import { GridZoomControls, type GridZoomProps } from "./GridZoomControls";

interface StepperProps {
  bars: number;
  onSetBars: (bars: number) => void;
  /** Longest length on offer (default: the pattern cap). */
  max?: number;
}

/** − n + control for a pattern's bar count. Shared by the strip, the Patterns page rows and the
 * phone's picker footer. */
export function BarsStepper({ bars, onSetBars, max = MAX_PATTERN_BARS }: StepperProps) {
  return (
    <div className="bars-stepper" role="group" aria-label="Pattern length in bars">
      <span className="bars-stepper-label">Bars</span>
      <button className="btn small" onClick={() => onSetBars(bars - 1)} disabled={bars <= 1} aria-label="Fewer bars">
        −
      </button>
      <span className="bars-stepper-value">{bars}</span>
      <button className="btn small" onClick={() => onSetBars(bars + 1)} disabled={bars >= max} aria-label="More bars">
        +
      </button>
    </div>
  );
}

interface Props extends GridZoomProps {
  patterns: Pattern[];
  /** The pattern open in the timeline (what you are editing). */
  selectedPatternId: PatternId;
  /** The pattern the transport is sounding, or null while stopped/paused. Independent of the
   * selection: you can edit one pattern while another plays. */
  playingPatternId: PatternId | null;
  onStep: (direction: -1 | 1) => void;
  onRename: (id: PatternId, name: string) => void;
  onSetBars: (id: PatternId, bars: number) => void;
  onDuplicate: (id: PatternId) => void;
  onAddPattern: () => void;
  /** Open the playing pattern in the timeline. */
  onEditPlaying: () => void;
  /** "bar 2 / 4" for the playing pattern, read per frame (see RafText). */
  getPlayingBarText: () => string;
  /** Set while the edited pattern is a Composer sequence: the strip then drops launcher stepping / duplicating (a sequence is
   * not a launcher pattern) and the button at its right end returns to the Composer. */
  composer?: { onReturn: () => void };
  /** For a launcher pattern, that same button adds a copy of it to the Composer and goes there. */
  onAddToComposer: () => void;
  /** Longest length the edited pattern may have right now (a Composer sequence stops at its neighbour). */
  maxBars?: number;
}

/** The desktop pattern row: ONE fixed-height strip about *the pattern being edited* and nothing
 * else — step to the previous/next one, rename it, set its length, duplicate it, add a new one —
 * beside a separate readout of what is PLAYING (they can differ). There is no list here: choosing
 * among all patterns, queuing and deleting live in the Patterns page, so each place has one job. */
export function PatternStrip({
  patterns,
  selectedPatternId,
  playingPatternId,
  onStep,
  onRename,
  onSetBars,
  onDuplicate,
  onAddPattern,
  onEditPlaying,
  getPlayingBarText,
  composer,
  onAddToComposer,
  maxBars,
  ...gridZoom
}: Props) {
  const index = patterns.findIndex((p) => p.id === selectedPatternId);
  const selected = patterns[index] ?? patterns[0];
  const playing = playingPatternId ? patterns.find((p) => p.id === playingPatternId) : undefined;

  return (
    <div className="pattern-strip">
      <span className="pattern-strip-label editing">{composer ? "Sequence" : "Editing"}</span>
      {!composer && (
        <button className="btn small pattern-step" onClick={() => onStep(-1)} disabled={index <= 0} aria-label="Previous pattern" title="Previous pattern  [">
          ◀
        </button>
      )}
      {selected && (
        <input
          className="pattern-name-input pattern-strip-input"
          value={selected.name}
          aria-label="Pattern name"
          title="Rename the pattern you are editing"
          onChange={(e) => onRename(selected.id, e.target.value)}
        />
      )}
      {!composer && (
        <button
          className="btn small pattern-step"
          onClick={() => onStep(1)}
          disabled={index >= patterns.length - 1}
          aria-label="Next pattern"
          title="Next pattern  ]"
        >
          ▶
        </button>
      )}
      {selected && <BarsStepper bars={selected.bars} max={maxBars} onSetBars={(bars) => onSetBars(selected.id, bars)} />}
      {selected && !composer && (
        <button className="btn small" onClick={() => onDuplicate(selected.id)} title="Duplicate this pattern and open the copy">
          Duplicate
        </button>
      )}
      {!composer && (
        <>
          <button className="btn small" onClick={onAddPattern} title="Add an empty pattern">
            + New
          </button>
        </>
      )}

      <span className="pattern-strip-divider" aria-hidden="true" />

      <span className="pattern-strip-label playing">Playing</span>
      <span className={`pattern-strip-playing ${playing ? "" : "idle"}`}>
        {playing ? (
          <>
            ▶ {playing.name} <RafText className="pattern-strip-playing-bar" getText={getPlayingBarText} />
          </>
        ) : (
          "stopped"
        )}
      </span>
      {playing && playing.id !== selectedPatternId && (
        <button className="btn small" onClick={onEditPlaying} title={`Open ${playing.name} in the timeline`}>
          Edit this
        </button>
      )}

      <div className="pattern-strip-view">
        <GridZoomControls {...gridZoom} />
      </div>
      {/* The one way into the Composer, always at the strip's right end: the Sequencer's half of the Composer's own
          "Edit Sequence ▸" button, which sits at the right end of its toolbar. */}
      {composer ? (
        <button className="btn small view-switch-btn" onClick={composer.onReturn} title="Back to the Composer timeline, this sequence still selected">
          ◂ Composer
        </button>
      ) : (
        <button className="btn small view-switch-btn" onClick={onAddToComposer} title="Add a copy of this pattern to the Composer timeline and go there">
          + Composer
        </button>
      )}
    </div>
  );
}
