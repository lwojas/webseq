import type { ComponentProps } from "react";
import { SIDE_PANEL_VIEWS, type SidePanelView } from "./layout";
import { AssetsPanel } from "../components/AssetsPanel";
import { EditPanel } from "../components/EditPanel";
import { MidiPanel } from "../components/MidiPanel";

interface Props {
  view: SidePanelView;
  onSelectView: (view: SidePanelView) => void;
  assets: ComponentProps<typeof AssetsPanel>;
  midi: ComponentProps<typeof MidiPanel>;
  edit: ComponentProps<typeof EditPanel>;
}

/** The column left of the timeline: a tab strip over whichever view is selected (Assets, MIDI, and
 * Edit — the clipboard and bar tools, beside the grid they act on). Only the selected view is
 * mounted. (On a phone the strip is hidden and the Library tab's sub-tabs choose the view.) */
export function SidePanel({ view, onSelectView, assets, midi, edit }: Props) {
  return (
    <aside className="side-panel">
      <div className="side-panel-tabs">
        {SIDE_PANEL_VIEWS.map((v) => (
          <button key={v.id} className={`side-panel-tab ${view === v.id ? "active" : ""}`} onClick={() => onSelectView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="side-panel-content">
        {view === "assets" && <AssetsPanel {...assets} />}
        {view === "midi" && <MidiPanel {...midi} />}
        {view === "edit" && <EditPanel {...edit} />}
      </div>
    </aside>
  );
}
