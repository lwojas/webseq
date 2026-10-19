// The editing side of automation: what the modulation cards and the timeline's automation row
// need, built from the project and the current selection. Automation is addressed uniformly by
// (owner, fxId | null, parameter), so FX parameters, synth controls and sample parameters all go
// through the same handlers (model/automation.ts, model/modulation.ts).
import { useCallback, useMemo, useState, type Dispatch } from "react";
import type { Action } from "../model/reducer";
import { applyTemplate, templateById, type TemplateRange } from "../model/automationTemplates";
import { findLane } from "../model/automation";
import { FX_DEFS } from "../model/fx";
import { fxParamDefs, sourceParamDefs, type ModParamDef } from "../model/modulation";
import { DEFAULT_ENVELOPE, totalBeats, trackById, type FxId, type FxInstance, type FxTarget, type Pattern, type Project, type Track } from "../model/types";
import type { AutomationUi } from "../components/ModulationSlot";
import type { AutomationRowProps } from "../components/AutomationRow";

interface LaneFocus {
  target: FxTarget;
  fxId: FxId | null;
  parameter: string;
}

interface Options {
  project: Project;
  dispatch: Dispatch<Action>;
  selectedTarget: FxTarget;
  pattern: Pattern;
  pxPerBeat: number;
  /** The timeline (which hosts the lane row) is on screen. When it is not, cards draw the lane inline. */
  timelineVisible: boolean;
}

/** The parameter's current base value: what a fresh lane starts flat at, so adding automation
 * changes nothing audible until the curve is edited. */
function baseValue(def: ModParamDef, fx: FxInstance | null, track: Track | null, project: Project): number {
  if (fx) return fx.params[def.id] ?? def.default;
  if (track?.instrument) return track.instrument.params[def.id] ?? def.default;
  if (track?.assetId != null) {
    const env = project.assets.find((a) => a.id === track.assetId)?.envelope ?? DEFAULT_ENVELOPE;
    if (def.id in env) return env[def.id as keyof typeof env];
  }
  return def.default;
}

export function useAutomationEditing({ project, dispatch, selectedTarget, pattern, pxPerBeat, timelineVisible }: Options) {
  const [laneFocus, setLaneFocus] = useState<LaneFocus | null>(null);
  const focus = laneFocus && laneFocus.target === selectedTarget ? laneFocus : null;

  const owner = selectedTarget === "master" ? project.master : trackById(project, selectedTarget);
  const track = selectedTarget === "master" ? null : (trackById(project, selectedTarget) ?? null);
  const beats = totalBeats(pattern, project.beatsPerBar);
  const beatsPerBar = project.beatsPerBar;

  const automationFor = useCallback(
    (fxId: FxId | null): AutomationUi | undefined => {
      if (!owner) return undefined;
      const fx = fxId ? (owner.fx.find((f) => f.id === fxId) ?? null) : null;
      if (fxId && !fx) return undefined;
      const params = fx ? fxParamDefs(fx) : track ? sourceParamDefs(track) : [];
      if (params.length === 0) return undefined;
      const lanes = owner.automation.filter((l) => (l.fxId ?? null) === fxId);
      const def = (p: string) => params.find((d) => d.id === p);
      const setFocus = (parameter: string | null) => setLaneFocus(parameter ? { target: selectedTarget, fxId, parameter } : null);
      const startFlat = (parameter: string) => {
        const d = def(parameter);
        if (!d) return;
        dispatch({ type: "SET_AUTOMATION_POINT", target: selectedTarget, fxId, parameter, position: 0, value: baseValue(d, fx, track, project) });
      };
      return {
        params,
        lanes,
        focused: focus && focus.fxId === fxId ? focus.parameter : null,
        totalBeats: beats,
        beatsPerBar,
        pxPerBeat,
        inline: !timelineVisible,
        // Idempotent: adding a parameter that already has a lane just opens it.
        onAdd: (parameter) => {
          if (!lanes.some((l) => l.parameter === parameter)) startFlat(parameter);
          setFocus(parameter);
        },
        onFocus: setFocus,
        onReset: (parameter) => {
          dispatch({ type: "CLEAR_AUTOMATION_LANE", target: selectedTarget, fxId, parameter });
          startFlat(parameter);
        },
        onRemove: (parameter) => {
          dispatch({ type: "CLEAR_AUTOMATION_LANE", target: selectedTarget, fxId, parameter });
          if (focus && focus.fxId === fxId && focus.parameter === parameter) setLaneFocus(null);
        },
        onMove: (from, to) => {
          dispatch({ type: "CLEAR_AUTOMATION_LANE", target: selectedTarget, fxId, parameter: from });
          startFlat(to);
          setFocus(to);
        },
        onTemplate: (parameter, templateId: string, range: TemplateRange) => {
          const d = def(parameter);
          const t = templateById(templateId);
          if (!d || !t) return;
          const { from, to, events } = applyTemplate(t, range, d, beats, beatsPerBar);
          dispatch({ type: "REPLACE_AUTOMATION_RANGE", target: selectedTarget, fxId, parameter, from, to, events });
          setFocus(parameter);
        },
        onSetPoint: (parameter, position, value) => dispatch({ type: "SET_AUTOMATION_POINT", target: selectedTarget, fxId, parameter, position, value }),
        onRemovePoint: (parameter, position) => dispatch({ type: "REMOVE_AUTOMATION_POINT", target: selectedTarget, fxId, parameter, position }),
      };
    },
    [owner, track, project, dispatch, selectedTarget, focus, beats, beatsPerBar, pxPerBeat, timelineVisible],
  );

  // Handlers depend only on the focus and the target, never on the project, so they keep their
  // identity across project edits and AutomationRow's memo comparator can skip re-rendering.
  const rowHandlers = useMemo(() => {
    if (!focus) return null;
    const { fxId, parameter } = focus;
    return {
      onSetPoint: (position: number, value: number) => dispatch({ type: "SET_AUTOMATION_POINT", target: selectedTarget, fxId, parameter, position, value }),
      onRemovePoint: (position: number) => dispatch({ type: "REMOVE_AUTOMATION_POINT", target: selectedTarget, fxId, parameter, position }),
      onClose: () => setLaneFocus(null),
    };
  }, [focus, dispatch, selectedTarget]);

  /** The focused lane as a row of the timeline, or null when nothing is focused (or it is gone). */
  const row = useMemo<AutomationRowProps | null>(() => {
    if (!focus || !owner || !rowHandlers) return null;
    const fx = focus.fxId ? (owner.fx.find((f) => f.id === focus.fxId) ?? null) : null;
    if (focus.fxId && !fx) return null;
    const params = fx ? fxParamDefs(fx) : track ? sourceParamDefs(track) : [];
    const def = params.find((p) => p.id === focus.parameter);
    const lane = findLane(owner.automation, focus.fxId, focus.parameter);
    if (!def || !lane) return null;
    const owned = fx ? FX_DEFS[fx.type].label : (track?.name ?? "");
    return { label: `${owned} · ${def.label}`, lane, paramDef: def, ...rowHandlers };
  }, [focus, owner, track, rowHandlers]);

  return { automationFor, row, clearFocus: useCallback(() => setLaneFocus(null), []) };
}
