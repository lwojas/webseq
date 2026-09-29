import { FX_DEFS } from "../model/fx";
import type { FxId, FxInstance, FxType } from "../model/types";

interface Props {
  fx: FxInstance[];
  selectedFxId: FxId | null;
  onSelectFx: (id: FxId) => void;
  onAddFx: (type: FxType) => void;
  onRemoveFx: (id: FxId) => void;
}

const ALL_TYPES = Object.keys(FX_DEFS) as FxType[];

/** Compact chip row for one FX chain, e.g. `[ Filter ] [ Delay ] [ + Filter ] [ + Delay ]` —
 * keeps the timeline/module panel from being overwhelmed when a track has multiple FX (see
 * project brief section 13). Only offers "+<type>" for a type not already in the chain: the
 * audio engine has exactly one filter slot and one delay slot per bus, so a second of the
 * same type would have nothing distinct to control (see model/fx.ts's doc comment). */
export function FxChainStrip({ fx, selectedFxId, onSelectFx, onAddFx, onRemoveFx }: Props) {
  const presentTypes = new Set(fx.map((f) => f.type));

  return (
    <div className="fx-chain-strip">
      {fx.map((instance) => (
        <div key={instance.id} className={`fx-chip ${instance.id === selectedFxId ? "active" : ""} ${instance.enabled ? "" : "bypassed"}`}>
          <button className="fx-chip-label" onClick={() => onSelectFx(instance.id)}>
            {FX_DEFS[instance.type].label}
          </button>
          <button className="fx-chip-remove" onClick={() => onRemoveFx(instance.id)} title="Remove FX">
            ×
          </button>
        </div>
      ))}
      {ALL_TYPES.filter((t) => !presentTypes.has(t)).map((t) => (
        <button key={t} className="btn small" onClick={() => onAddFx(t)}>
          + {FX_DEFS[t].label}
        </button>
      ))}
    </div>
  );
}
