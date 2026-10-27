import { COMPOSER_COLORS, DEFAULT_LANE_MODIFIERS, MAX_GATE_SCALE, MAX_TRANSPOSE, MAX_VELOCITY_SCALE, MIN_GATE_SCALE, MIN_VELOCITY_SCALE, isIdentity, laneModifiers, maxSequenceBars, sequenceBars, sequenceName } from "../model/composer";
import type { ComposerLane, ComposerSequence, LaneModifiers, Pattern, Project } from "../model/types";
import { BarsStepper } from "./PatternStrip";

export interface ComposerDetailsProps {
  project: Project;
  sequence: ComposerSequence | undefined;
  lane: ComposerLane | undefined;
  /** Launcher patterns that can be copied onto the selected lane. */
  launcher: Pattern[];
  onRename: (name: string) => void;
  onResize: (bars: number) => void;
  onColor: (color: string) => void;
  /** Whether `bars` bars can be inserted at the marker (always true with no marker). */
  canInsertBars: (bars: number) => boolean;
  blockedReason: string;
  onAddPattern: (patternId: string) => void;
  onSetLaneModifiers: (patch: Partial<LaneModifiers>) => void;
}

/** The detailed side of arranging, in the Edit panel: the selected sequence's name, length and colour, adding a launcher
 * pattern, and the selected lane's musical modifiers. The Composer's own toolbar has only the quick actions; nothing is in
 * both. Presentational. */
export function ComposerDetails({ project, sequence, lane, launcher, onRename, onResize, onColor, canInsertBars, blockedReason, onAddPattern, onSetLaneModifiers }: ComposerDetailsProps) {
  const m = laneModifiers(lane);
  // Label on the left, [ − value + ] on the right, so the three rows line up whatever their label or value is.
  const step = (label: string, shown: string, down: () => void, up: () => void, canDown: boolean, canUp: boolean) => (
    <div className="composer-mod-row" role="group" aria-label={label}>
      <span className="composer-mod-label">{label}</span>
      <span className="composer-mod-controls">
        <button className="btn small" onClick={down} disabled={!canDown} aria-label={`Lower ${label}`}>
          −
        </button>
        <span className="composer-mod-value">{shown}</span>
        <button className="btn small" onClick={up} disabled={!canUp} aria-label={`Raise ${label}`}>
          +
        </button>
      </span>
    </div>
  );
  return (
    <>
      <section className="edit-group">
        <div className="edit-group-title">Sequence{sequence ? "" : " — none selected"}</div>
        {sequence && (
          <>
            <div className="edit-row">
              <input className="pattern-name-input composer-name-input" value={sequenceName(project, sequence)} aria-label="Sequence name" onChange={(e) => onRename(e.target.value)} />
            </div>
            <div className="edit-row">
              <BarsStepper bars={sequenceBars(project, sequence)} max={maxSequenceBars(project, sequence)} onSetBars={onResize} />
            </div>
            <div className="edit-row composer-swatches" role="group" aria-label="Sequence colour">
              {COMPOSER_COLORS.map((c) => (
                <button key={c} className={`composer-swatch ${sequence.color === c ? "active" : ""}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => onColor(c)} />
              ))}
            </div>
          </>
        )}
        <div className="edit-row">
          <select
            className="composer-add-select"
            value=""
            aria-label="Add a launcher pattern to the selected lane"
            title="Add a copy of a launcher pattern at the marker (or the end of the selected lane if there is no marker)"
            onChange={(e) => e.target.value && onAddPattern(e.target.value)}
          >
            <option value="">+ Add pattern…</option>
            {launcher.map((p) => (
              <option key={p.id} value={p.id} disabled={!canInsertBars(p.bars)} title={canInsertBars(p.bars) ? undefined : blockedReason}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </section>
      {lane && (
        <section className="edit-group">
          <div className="edit-group-title">Lane modifiers · {lane.name}</div>
          <div className="edit-row-status">Change which notes are played, not how they sound. Applied to every sequence on this lane.</div>
          <div className="edit-row">
            {step("Transpose", `${m.transpose > 0 ? "+" : ""}${m.transpose} st`, () => onSetLaneModifiers({ transpose: m.transpose - 1 }), () => onSetLaneModifiers({ transpose: m.transpose + 1 }), m.transpose > -MAX_TRANSPOSE, m.transpose < MAX_TRANSPOSE)}
          </div>
          <div className="edit-row">
            {step("Velocity", `${Math.round(m.velocity * 100)}%`, () => onSetLaneModifiers({ velocity: m.velocity - 0.1 }), () => onSetLaneModifiers({ velocity: m.velocity + 0.1 }), m.velocity > MIN_VELOCITY_SCALE, m.velocity < MAX_VELOCITY_SCALE)}
          </div>
          <div className="edit-row">
            {step("Gate", `${Math.round(m.gate * 100)}%`, () => onSetLaneModifiers({ gate: m.gate - 0.25 }), () => onSetLaneModifiers({ gate: m.gate + 0.25 }), m.gate > MIN_GATE_SCALE, m.gate < MAX_GATE_SCALE)}
          </div>
          <div className="edit-row composer-mod-reset">
            <button className="track-copy-btn" disabled={isIdentity(m)} onClick={() => onSetLaneModifiers(DEFAULT_LANE_MODIFIERS)}>
              Reset
            </button>
          </div>
        </section>
      )}
    </>
  );
}
