interface Props {
  width: number;
  selected: boolean;
  fxCount: number;
  onSelect: () => void;
}

/** The MASTER row: a selectable bus/control row, not a sample-producing track (see project
 * brief section 9) — clicking it shows master FX in the bottom panel exactly like clicking a
 * track shows that track's FX, but it has no sample slot, no notes, and no per-beat cells. */
export function MasterRow({ width, selected, fxCount, onSelect }: Props) {
  return (
    <div className={`track-row master-row ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="track-header">
        <span className="track-name master-name">MASTER</span>
        {fxCount > 0 && <span className="track-fx-badge">{fxCount}FX</span>}
      </div>
      <div className="track-lane master-lane" style={{ width }} />
    </div>
  );
}
