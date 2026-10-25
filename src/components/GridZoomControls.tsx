import { GRID_RESOLUTIONS, type GridResolution } from "../model/notes";

/** Label for a toolbar grid-resolution option, e.g. 1 -> "1", 0.25 -> "1/4". */
function gridResolutionLabel(resolution: GridResolution): string {
  return resolution === 1 ? "1" : `1/${Math.round(1 / resolution)}`;
}

export interface GridZoomProps {
  gridResolution: GridResolution;
  onGridResolutionChange: (resolution: GridResolution) => void;
  /** Current timeline zoom, as a percentage of the default zoom level (100% = default) — see
   * useTimelineZoom (ECS-53). */
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

/** The timeline's view controls: the grid resolution drag/resize snaps to, and the zoom. Shared by
 * the desktop pattern strip (right-aligned) and the phone's Settings view. */
export function GridZoomControls({ gridResolution, onGridResolutionChange, zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut }: GridZoomProps) {
  return (
    <>
      <div className="field">
        <span>Grid</span>
        <select
          value={gridResolution}
          onChange={(e) => onGridResolutionChange(Number(e.target.value) as GridResolution)}
          title="Musical grid resolution drag/resize snaps to — hold Alt/Option while dragging to override"
        >
          {GRID_RESOLUTIONS.map((resolution) => (
            <option key={resolution} value={resolution}>
              {gridResolutionLabel(resolution)}
            </option>
          ))}
        </select>
      </div>

      <div className="field zoom-control">
        <span>Zoom</span>
        <button className="btn small" onClick={onZoomOut} disabled={!canZoomOut} aria-label="Zoom out" title="Zoom out">
          −
        </button>
        <span className="zoom-level">{zoomPercent}%</span>
        <button className="btn small" onClick={onZoomIn} disabled={!canZoomIn} aria-label="Zoom in" title="Zoom in">
          +
        </button>
      </div>
    </>
  );
}
