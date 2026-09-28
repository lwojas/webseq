// The first (and, for this prototype, only) module: a master/output resonant filter. It
// processes the *entire* mixed signal — implemented by calling
// AudioRuntime.setNodeParameter(MASTER_BUS, ...), webdsp's public bus-addressed parameter
// API, never a per-voice/per-track call. See webdsp's native/src/bus.h: the master bus now
// carries a BiquadFilter ahead of its existing delay send, so this module's cutoff/
// resonance/mode changes shape the output of every track at once, after the mixer.
import { FilterMode, MASTER_BUS, NodeParam, type AudioRuntime } from "webdsp";
import { useCallback, useMemo, useState } from "react";
import type { AudioModule, ModuleParameter } from "./types";

const MIN_CUTOFF_HZ = 40;
const MAX_CUTOFF_HZ = 18000;
const DEFAULT_CUTOFF_HZ = 18000; // effectively pass-through in LowPass mode until touched
const DEFAULT_RESONANCE = 0.707; // Butterworth Q, no resonant peak
const MAX_RESONANCE = 20;

interface FilterState {
  mode: FilterMode;
  cutoffHz: number;
  resonance: number;
  enabled: boolean;
}

export function useMasterFilterModule(runtime: AudioRuntime | null): AudioModule {
  const [state, setState] = useState<FilterState>({
    mode: FilterMode.LowPass,
    cutoffHz: DEFAULT_CUTOFF_HZ,
    resonance: DEFAULT_RESONANCE,
    enabled: true,
  });

  const apply = useCallback(
    (next: FilterState) => {
      if (!runtime) return;
      // `enabled: false` has no dedicated engine-side bypass (see NodeParam docs) — approximated
      // by pushing the cutoff to the edge of the audible range in whichever direction is
      // transparent for the current mode, which is an honest, documented approximation rather
      // than a true DSP bypass.
      const effectiveCutoff = next.enabled
        ? next.cutoffHz
        : next.mode === FilterMode.LowPass
          ? MAX_CUTOFF_HZ
          : MIN_CUTOFF_HZ;
      runtime.setNodeParameter(MASTER_BUS, NodeParam.FilterMode, next.mode);
      runtime.setNodeParameter(MASTER_BUS, NodeParam.FilterCutoff, effectiveCutoff);
      runtime.setNodeParameter(MASTER_BUS, NodeParam.FilterResonance, next.resonance);
    },
    [runtime],
  );

  const setParameter = useCallback(
    (paramId: string, value: number) => {
      setState((prev) => {
        const next: FilterState =
          paramId === "mode"
            ? { ...prev, mode: value as FilterMode }
            : paramId === "cutoff"
              ? { ...prev, cutoffHz: value }
              : paramId === "resonance"
                ? { ...prev, resonance: value }
                : prev;
        apply(next);
        return next;
      });
    },
    [apply],
  );

  const setEnabled = useCallback(
    (enabled: boolean) => {
      setState((prev) => {
        const next = { ...prev, enabled };
        apply(next);
        return next;
      });
    },
    [apply],
  );

  const parameters: ModuleParameter[] = useMemo(
    () => [
      {
        id: "mode",
        label: "Mode",
        kind: "enum",
        value: state.mode,
        options: [
          { label: "Low Pass", value: FilterMode.LowPass },
          { label: "High Pass", value: FilterMode.HighPass },
        ],
      },
      {
        id: "cutoff",
        label: "Cutoff",
        kind: "range",
        value: state.cutoffHz,
        min: MIN_CUTOFF_HZ,
        max: MAX_CUTOFF_HZ,
        step: 1,
        unit: "Hz",
      },
      {
        id: "resonance",
        label: "Resonance",
        kind: "range",
        value: state.resonance,
        min: 0.1,
        max: MAX_RESONANCE,
        step: 0.01,
        unit: "Q",
      },
    ],
    [state],
  );

  return {
    id: "master-filter",
    name: "Master Filter",
    enabled: state.enabled,
    parameters,
    setParameter,
    setEnabled,
  };
}
