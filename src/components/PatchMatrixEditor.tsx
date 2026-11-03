import { useMemo, useRef, useState } from "react";
import { MATRIX_INS, MATRIX_OUTS, type MatrixIn, type MatrixOut } from "webdsp";
import {
  KIND_LABEL,
  MATRIX_COLUMN_GROUPS,
  MATRIX_ROW_GROUPS,
  amountFromDrag,
  cellId,
  defaultAmount,
  describePatch,
  findPatch,
  formatAmount,
  inLabel,
  inName,
  kindOf,
  outLabel,
  readPatches,
  snapAmount,
  wouldBeFeedback,
  type MatrixPatchKind,
} from "../model/patchMatrixView";
import { ModBadge } from "./ModulationSlot";

interface Props {
  /** The Matrix synth's flat control values (track.instrument.params); a cell it has not stored is `cellDefault`. */
  params: Record<string, number>;
  cellDefault: (id: string) => number;
  onSetParam: (paramId: string, value: number) => void;
  /** Which cells are automated or LFO-driven (marker in the editor). */
  badges?: Record<string, { auto: boolean; lfos: number }>;
  /** Automates the selected cell's mix. */
  onAutomate?: (paramId: string) => void;
}

type Cell = { out: MatrixOut; input: MatrixIn };
type Focus = { side: "out" | "in"; index: number } | null;

const kindClass = (k: MatrixPatchKind) => `matrix-${k}`;

/** The Matrix synth's patch bay as a matrix: outs run across the top, ins down the side, one cell per cable. A
 * click on an empty cell patches it, dragging a patched cell sideways sets its mix, Delete removes it. A cell's
 * colour is its kind: audio (cyan), control (amber), feedback (red); empty cells that would close a loop are
 * marked before they are made. A small editor beside the grid adjusts the selected connection. The ordinary
 * voice is just the default cables, so the audio path can be removed or redirected like any other cable. */
export function PatchMatrixEditor({ params, cellDefault, onSetParam, badges, onAutomate }: Props) {
  const [sel, setSel] = useState<Cell | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const dragged = useRef(false);
  const patches = useMemo(() => readPatches(params, cellDefault), [params, cellDefault]);

  const amountOf = (c: Cell) => findPatch(patches, c.out, c.input)?.amount ?? 0;
  const setAmount = (c: Cell, v: number) => onSetParam(cellId(c.out, c.input), snapAmount(v));

  function onCellPointerDown(e: React.PointerEvent<HTMLButtonElement>, c: Cell) {
    const a0 = amountOf(c);
    if (e.button !== 0 || a0 === 0) return;
    const x0 = e.clientX;
    const width = e.currentTarget.getBoundingClientRect().width;
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      if (!dragged.current && Math.abs(ev.clientX - x0) < 4) return;
      dragged.current = true;
      setSel(c);
      onSetParam(cellId(c.out, c.input), amountFromDrag(a0, ev.clientX - x0, width));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function onCellClick(c: Cell) {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (amountOf(c) === 0) onSetParam(cellId(c.out, c.input), defaultAmount(c.input));
    setSel(c);
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    if (!sel) return;
    const a = amountOf(sel);
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setAmount(sel, 0);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setAmount(sel, a + (e.shiftKey ? 0.01 : 0.05));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setAmount(sel, a - (e.shiftKey ? 0.01 : 0.05));
    } else if (e.key === "Escape") {
      setSel(null);
    }
  }

  const toggleFocus = (f: NonNullable<Focus>) => setFocus((cur) => (cur && cur.side === f.side && cur.index === f.index ? null : f));
  const outs = MATRIX_COLUMN_GROUPS.flatMap((g) => g.outs);

  const statusFor = (c: Cell) => {
    const a = amountOf(c);
    const d = describePatch(c.out, c.input, a || defaultAmount(c.input), patches);
    return a !== 0
      ? `${d.title}  ${formatAmount(a)}  \u00B7 ${d.name}${d.kind === "feedback" ? "  \u00B7 feedback" : ""}`
      : `Patch ${d.title}  \u00B7 ${d.name}${d.kind === "feedback" ? "  \u00B7 would make feedback" : ""}`;
  };

  return (
    <div className="matrix-view">
      <div className="matrix-main">
        <div className="matrix-scroll">
          <div className="matrix-grid" onKeyDown={onGridKeyDown}>
            <div className="matrix-corner">{"In \u2193 / Out \u2192"}</div>
            {MATRIX_COLUMN_GROUPS.map((g) => (
              <div key={g.label} className={`matrix-group matrix-${MATRIX_OUTS[g.outs[0]].signal}`} style={{ gridColumn: `span ${g.outs.length}` }}>
                {g.label}
              </div>
            ))}
            <div />
            {outs.map((out) => (
              <button
                key={out}
                className={`matrix-out matrix-${MATRIX_OUTS[out].signal}${focus?.side === "out" && focus.index === out ? " focus" : ""}`}
                onClick={() => toggleFocus({ side: "out", index: out })}
                title={`Highlight everything ${outLabel(out)} is patched into`}
              >
                {outLabel(out)}
              </button>
            ))}
            {MATRIX_ROW_GROUPS.map((group) => [
              <div key={`h-${group.label}`} className="matrix-section">{group.label}</div>,
              ...group.ins.flatMap((input) => [
                <button
                  key={`r-${input}`}
                  className={`matrix-in${focus?.side === "in" && focus.index === input ? " focus" : ""}`}
                  onClick={() => toggleFocus({ side: "in", index: input })}
                  title={`Highlight everything patched into ${inName(input)}`}
                >
                  {inLabel(input)}
                </button>,
                ...outs.map((out) => {
                  const c: Cell = { out, input };
                  const a = amountOf(c);
                  const id = cellId(out, input);
                  const patched = a !== 0;
                  const kind = kindOf(out, input, a || 1, patches);
                  const selected = sel?.out === out && sel.input === input;
                  const inFocus = focus && (focus.side === "out" ? focus.index === out : focus.index === input);
                  const cls = ["matrix-cell", patched ? `patched ${kindClass(kind)}` : "", selected ? "selected" : "", inFocus ? "focus" : "", !patched && wouldBeFeedback(out, input, patches) ? "would-feedback" : ""]
                    .filter(Boolean)
                    .join(" ");
                  const left = a >= 0 ? 50 : 50 + a * 50;
                  return (
                    <button
                      key={id}
                      className={cls}
                      aria-label={`${outLabel(out)} into ${inName(input)} ${patched ? formatAmount(a) : "not patched"}`}
                      aria-pressed={selected}
                      onPointerDown={(e) => onCellPointerDown(e, c)}
                      onClick={() => onCellClick(c)}
                      onContextMenu={(e) => {
                        if (!patched) return;
                        e.preventDefault();
                        setAmount(c, 0);
                      }}
                      onPointerEnter={() => setHover(c)}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover(c)}
                      onBlur={() => setHover(null)}
                    >
                      {patched ? (
                        <>
                          <span className="matrix-amount">
                            {kind === "feedback" ? "\u21BB " : ""}
                            {formatAmount(a)}
                          </span>
                          <span className="matrix-bar" style={{ left: `${left}%`, width: `${Math.abs(a) * 50}%` }} />
                        </>
                      ) : (
                        <span className="matrix-dot" />
                      )}
                    </button>
                  );
                }),
              ]),
            ])}
          </div>
        </div>
        <div className="matrix-status">
          {hover ? statusFor(hover) : "Click a cell to patch an out into an in \u00B7 drag a patched cell sideways to set its mix \u00B7 Delete or right-click removes it"}
        </div>
      </div>

      <div className="matrix-editor">
        {sel ? (
          <ConnectionEditor
            cell={sel}
            amount={amountOf(sel)}
            patches={patches}
            badge={badges?.[cellId(sel.out, sel.input)]}
            onSetAmount={(v) => setAmount(sel, v)}
            onAutomate={onAutomate ? () => onAutomate(cellId(sel.out, sel.input)) : undefined}
            onClose={() => setSel(null)}
          />
        ) : (
          <PatchList patches={patches} onSelect={setSel} />
        )}
      </div>
    </div>
  );
}

function ConnectionEditor({
  cell,
  amount,
  patches,
  badge,
  onSetAmount,
  onAutomate,
  onClose,
}: {
  cell: Cell;
  amount: number;
  patches: ReturnType<typeof readPatches>;
  badge?: { auto: boolean; lfos: number };
  onSetAmount: (v: number) => void;
  onAutomate?: () => void;
  onClose: () => void;
}) {
  const d = describePatch(cell.out, cell.input, amount || defaultAmount(cell.input), patches);
  const patched = amount !== 0;
  return (
    <div className={`module-panel matrix-connection ${kindClass(d.kind)}`}>
      <div className="module-panel-header">
        <span className="name">{d.title}</span>
        <span className="matrix-kind">{KIND_LABEL[d.kind]}</span>
        <button className="btn small" onClick={onClose} title="Back to the list of cables">
          Done
        </button>
      </div>
      <div className="module-param">
        <span className="param-label static">
          Mix
          <ModBadge badge={badge} />
        </span>
        <div className="range-row">
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={Math.round(amount * 100)}
            onChange={(e) => onSetAmount(Number(e.target.value) / 100)}
            aria-label={`Mix of ${d.title}`}
          />
          <span className="value">{patched ? formatAmount(amount) : "off"}</span>
        </div>
      </div>
      <div className="matrix-actions">
        <button className="btn small" disabled={!patched} onClick={() => onSetAmount(-amount)} title="Flip the sign: the signal then acts the other way">
          Invert
        </button>
        <button className="btn small danger" disabled={!patched} onClick={() => onSetAmount(0)} title="Remove the cable (a mix of 0 is no cable)">
          Remove
        </button>
        {onAutomate && (
          <button className="btn small" onClick={onAutomate} title="Automate this mix over the song">
            Automate
          </button>
        )}
      </div>
      {patched ? (
        <div className="matrix-readout">{d.readout}</div>
      ) : (
        <div className="matrix-readout">Not patched. Set a mix above, or click the cell again to start at {formatAmount(defaultAmount(cell.input))}.</div>
      )}
      <div className="matrix-sound">
        <span className="matrix-sound-name">{d.name}</span>
        <span className="matrix-sound-text">{d.text}</span>
      </div>
      {d.path ? (
        <div className="matrix-path" aria-label="Signal path">
          {d.path.map((step, i) => (
            <span key={i} className="matrix-path-step">
              {i > 0 && <span className="matrix-path-arrow">{"\u2192"}</span>}
              <span className={i < 2 ? "matrix-path-patch" : ""}>{step}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="matrix-readout">Goes nowhere you can hear: nothing connects {inName(cell.input)}'s module to the output.</div>
      )}
      {d.loop && (
        <div className="matrix-loop">
          Loop: {d.loop.join(" \u2192 ")}. It closes with one sample of delay and is limited, so it cannot run away.
        </div>
      )}
    </div>
  );
}

function PatchList({ patches, onSelect }: { patches: ReturnType<typeof readPatches>; onSelect: (c: Cell) => void }) {
  const order: Record<MatrixPatchKind, number> = { feedback: 0, audio: 1, control: 2 };
  const rows = patches
    .map((p) => ({ p, kind: kindOf(p.out, p.input, p.amount, patches) }))
    .sort((a, b) => order[a.kind] - order[b.kind]);
  return (
    <div className="module-panel matrix-connection">
      <div className="module-panel-header">
        <span className="name">Cables</span>
        <span className="matrix-kind">{patches.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="matrix-readout">Nothing is patched, so the voice is silent. Click a cell to connect an out to an in.</div>
      ) : (
        <div className="matrix-patch-list">
          {rows.map(({ p, kind }) => (
            <button key={`${p.out}-${p.input}`} className={`matrix-patch-row ${kindClass(kind)}`} onClick={() => onSelect({ out: p.out, input: p.input })}>
              <span className="matrix-patch-kind">{kind === "feedback" ? "\u21BB FB" : kind === "audio" ? "AUD" : "MOD"}</span>
              <span className="matrix-patch-name">
                {MATRIX_OUTS[p.out].name} {"\u2192"} {MATRIX_INS[p.input].name}
              </span>
              <span className="matrix-patch-amount">{formatAmount(p.amount)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="matrix-readout">Select a cable to adjust its mix. Outs run across the top, ins down the side.</div>
    </div>
  );
}
