// FX chain operations, generic over FxTarget (a track or the master bus — see types.ts).
// This is the one place that knows what a "filter" or "delay" *is* at the model level (their
// param keys, defaults, and ranges); src/audio/applyFx.ts is the only other place that needs
// to know it, translating these generic params into webdsp's NodeParam calls. The UI's
// module panel renders any FxInstance generically from FX_DEFS, the same way the old
// AudioModule abstraction rendered a single hand-written module.
//
// One real engine constraint shapes this: webdsp's Bus has exactly one filter slot and one
// delay slot (a fixed two-node DSPChain — see webdsp's ARCHITECTURE.md, "How DSP is
// composed"), not an arbitrary stack of either. So a chain may contain at most one FX of each
// type; addFx() is a no-op if that type is already present rather than adding a duplicate
// that could never be distinctly processed.

import type { FxId, FxInstance, FxTarget, FxType, Project, Track } from "./types";
import { fxOwner } from "./types";

export interface FxParamDef {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  default: number;
  /** Enum-valued params (currently only filter mode) list their options here instead of
   * min/max being meaningful as a continuous range. */
  options?: { label: string; value: number }[];
}

export interface FxDef {
  type: FxType;
  label: string;
  params: FxParamDef[];
}

// Values mirror webdsp's FilterMode (0 = LowPass, 1 = HighPass) — see audio/applyFx.ts.
export const FX_DEFS: Record<FxType, FxDef> = {
  filter: {
    type: "filter",
    label: "Filter",
    params: [
      {
        id: "mode",
        label: "Mode",
        min: 0,
        max: 1,
        step: 1,
        default: 0,
        options: [
          { label: "Low Pass", value: 0 },
          { label: "High Pass", value: 1 },
        ],
      },
      { id: "cutoff", label: "Cutoff", min: 40, max: 18000, step: 1, unit: "Hz", default: 18000 },
      { id: "resonance", label: "Resonance", min: 0.1, max: 20, step: 0.01, unit: "Q", default: 0.707 },
    ],
  },
  delay: {
    type: "delay",
    label: "Delay",
    params: [
      { id: "time", label: "Time", min: 0.02, max: 1.5, step: 0.01, unit: "s", default: 0.25 },
      { id: "feedback", label: "Feedback", min: 0, max: 0.95, step: 0.01, default: 0.3 },
      { id: "mix", label: "Mix", min: 0, max: 1, step: 0.01, default: 0 },
    ],
  },
};

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultParams(type: FxType): Record<string, number> {
  const params: Record<string, number> = {};
  for (const def of FX_DEFS[type].params) params[def.id] = def.default;
  return params;
}

function updateOwner(
  project: Project,
  target: FxTarget,
  update: (owner: { fx: FxInstance[]; automation: import("./types").AutomationLane[] }) => {
    fx: FxInstance[];
    automation: import("./types").AutomationLane[];
  },
): Project {
  const owner = fxOwner(project, target);
  if (!owner) return project;
  const updated = update(owner);
  if (target === "master") return { ...project, master: updated };
  return {
    ...project,
    tracks: project.tracks.map((t): Track => (t.id === target ? { ...t, ...updated } : t)),
  };
}

/** Appends a new FX of `type` with default params, unless the chain already has one of that
 * type (see module doc comment on the one-filter/one-delay engine constraint). */
export function addFx(project: Project, target: FxTarget, type: FxType): Project {
  return updateOwner(project, target, (owner) => {
    if (owner.fx.some((f) => f.type === type)) return owner;
    const instance: FxInstance = { id: nextId("fx"), type, enabled: true, params: defaultParams(type) };
    return { ...owner, fx: [...owner.fx, instance] };
  });
}

/** Removes an FX and any automation lanes that referenced it — an FX's automation cannot
 * outlive the FX itself. */
export function removeFx(project: Project, target: FxTarget, fxId: FxId): Project {
  return updateOwner(project, target, (owner) => ({
    fx: owner.fx.filter((f) => f.id !== fxId),
    automation: owner.automation.filter((a) => a.fxId !== fxId),
  }));
}

export function setFxParam(project: Project, target: FxTarget, fxId: FxId, paramId: string, value: number): Project {
  return updateOwner(project, target, (owner) => ({
    ...owner,
    fx: owner.fx.map((f) => (f.id === fxId ? { ...f, params: { ...f.params, [paramId]: value } } : f)),
  }));
}

export function setFxEnabled(project: Project, target: FxTarget, fxId: FxId, enabled: boolean): Project {
  return updateOwner(project, target, (owner) => ({
    ...owner,
    fx: owner.fx.map((f) => (f.id === fxId ? { ...f, enabled } : f)),
  }));
}
