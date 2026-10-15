import { FX_DEFS, MAX_FX_PER_CHAIN } from "../model/fx";
import type { FxId, FxInstance, FxType } from "../model/types";

interface Props {
  fx: FxInstance[];
  selectedFxId: FxId | null;
  onSelectFx: (id: FxId) => void;
  onAddFx: (type: FxType) => void;
  onRemoveFx: (id: FxId) => void;
  onMoveFx: (id: FxId, index: number) => void;
}

const ALL_TYPES = Object.keys(FX_DEFS) as FxType[];

/** Chip row for one FX chain, in signal-flow order (left to right), e.g.
 * `[ Filter 1 ] [ Saturation ] [ Filter 2 ]  + Add FX…`. The chain is a real stack: the same
 * type may appear more than once (a repeated type is numbered) and the selected chip can be
 * moved earlier/later, which changes the sound for nonlinear/dynamics effects. Adding goes
 * through one select rather than a button per type, so the row stays one line as the FX list
 * grows. */
export function FxChainStrip({ fx, selectedFxId, onSelectFx, onAddFx, onRemoveFx, onMoveFx }: Props) {
  const totals = new Map<FxType, number>();
  for (const f of fx) totals.set(f.type, (totals.get(f.type) ?? 0) + 1);
  const seen = new Map<FxType, number>();

  return (
    <div className="fx-chain-strip">
      {fx.map((instance, index) => {
        const n = (seen.get(instance.type) ?? 0) + 1;
        seen.set(instance.type, n);
        const label = FX_DEFS[instance.type].label + ((totals.get(instance.type) ?? 0) > 1 ? ` ${n}` : "");
        const active = instance.id === selectedFxId;
        return (
          <div key={instance.id} className={`fx-chip ${active ? "active" : ""} ${instance.enabled ? "" : "bypassed"}`}>
            {active && (
              <button
                className="fx-chip-move"
                disabled={index === 0}
                onClick={() => onMoveFx(instance.id, index - 1)}
                title="Move earlier in the chain"
                aria-label={`Move ${label} earlier`}
              >
                ‹
              </button>
            )}
            <button className="fx-chip-label" onClick={() => onSelectFx(instance.id)}>
              {label}
            </button>
            {active && (
              <button
                className="fx-chip-move"
                disabled={index === fx.length - 1}
                onClick={() => onMoveFx(instance.id, index + 1)}
                title="Move later in the chain"
                aria-label={`Move ${label} later`}
              >
                ›
              </button>
            )}
            <button className="fx-chip-remove" onClick={() => onRemoveFx(instance.id)} title="Remove FX" aria-label={`Remove ${label}`}>
              ×
            </button>
          </div>
        );
      })}
      <select
        className="fx-add-select"
        value=""
        disabled={fx.length >= MAX_FX_PER_CHAIN}
        onChange={(e) => {
          if (e.target.value) onAddFx(e.target.value as FxType);
        }}
        aria-label="Add FX"
      >
        <option value="">+ Add FX…</option>
        {ALL_TYPES.map((t) => (
          <option key={t} value={t}>
            {FX_DEFS[t].label}
          </option>
        ))}
      </select>
    </div>
  );
}
