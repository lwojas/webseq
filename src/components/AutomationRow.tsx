import { memo } from "react";
import type { AutomationLane as AutomationLaneModel } from "../model/types";
import type { ModParamDef } from "../model/modulation";
import { AutomationLane, AUTOMATION_LANE_HEIGHT, formatBars } from "./AutomationLane";

export interface AutomationRowProps {
  /** What is automated, for the row's label (e.g. "Filter · Cutoff"). */
  label: string;
  lane: AutomationLaneModel | undefined;
  paramDef: ModParamDef;
  onSetPoint: (position: number, value: number) => void;
  onRemovePoint: (position: number) => void;
  onClose: () => void;
}

export interface Props extends AutomationRowProps {
  totalBeats: number;
  beatsPerBar: number;
  pxPerBeat: number;
  visibleStart: number;
  visibleEnd: number;
}

/** The automation lane as a row of the timeline itself: it is rendered inside SequencerGrid's
 * scroll area, directly under the selected track (or MASTER), with the same sticky header column
 * and the same `pxPerBeat` as every other row. There is no second timeline: the lane is exactly
 * as wide as the sequence, grows with its bars, scrolls and zooms with it, and shares the
 * playhead. The header states how long the lane is, in bars. */
function AutomationRowImpl({ label, lane, paramDef, totalBeats, beatsPerBar, pxPerBeat, visibleStart, visibleEnd, onSetPoint, onRemovePoint, onClose }: Props) {
  return (
    <div className="track-row automation-row" style={{ height: AUTOMATION_LANE_HEIGHT + 8 }}>
      <div className="track-header automation-row-header">
        <div className="automation-row-title" title={`${label} automation`}>
          <span className="automation-row-kind">Auto</span> {label}
        </div>
        <div className="automation-row-meta">
          <span className="automation-bars" title="Length of the lane: the sequence it is drawn over">
            {formatBars(totalBeats / beatsPerBar)}
          </span>
          <button className="automation-row-close" onClick={onClose} aria-label="Hide automation lane" title="Hide the lane (the automation keeps playing)">
            ×
          </button>
        </div>
      </div>
      <div className="track-lane automation-row-lane" style={{ width: totalBeats * pxPerBeat }}>
        <AutomationLane
          lane={lane}
          paramDef={paramDef}
          totalBeats={totalBeats}
          beatsPerBar={beatsPerBar}
          pxPerBeat={pxPerBeat}
          height={AUTOMATION_LANE_HEIGHT}
          visibleStart={visibleStart}
          visibleEnd={visibleEnd}
          onSetPoint={onSetPoint}
          onRemovePoint={onRemovePoint}
        />
      </div>
    </div>
  );
}

/** Re-render only when something the row shows changed. `paramDef` is rebuilt by the model on every
 * project edit, so it is compared by value; `lane` keeps its identity until the lane is edited;
 * the handlers are stable (useAutomationEditing). Written out field by field like TrackRow's
 * comparator; test/automationRow.test.ts fails if a prop is added and not compared here. */
export function sameAutomationRow(a: Props, b: Props): boolean {
  const da = a.paramDef;
  const db = b.paramDef;
  return (
    a.label === b.label &&
    a.lane === b.lane &&
    a.totalBeats === b.totalBeats &&
    a.beatsPerBar === b.beatsPerBar &&
    a.pxPerBeat === b.pxPerBeat &&
    a.visibleStart === b.visibleStart &&
    a.visibleEnd === b.visibleEnd &&
    a.onSetPoint === b.onSetPoint &&
    a.onRemovePoint === b.onRemovePoint &&
    a.onClose === b.onClose &&
    (da === db ||
      (da.id === db.id && da.min === db.min && da.max === db.max && da.step === db.step && da.default === db.default && da.unit === db.unit && da.scale === db.scale))
  );
}

export const AutomationRow = memo(AutomationRowImpl, sameAutomationRow);
