import type { ComponentProps } from "react";
import { dockLabel, type BottomPanelView } from "./layout";
import { EditPanel } from "../components/EditPanel";
import { FxPanel } from "../components/FxPanel";
import { InstrumentPanel } from "../components/InstrumentPanel";
import { MixerPanel } from "../components/MixerPanel";
import { TrackEditor } from "../components/TrackEditor";

interface Props {
  isPhone: boolean;
  /** The tabs on offer (empty on the phone's Mixer tab, which has no strip). */
  views: BottomPanelView[];
  active: BottomPanelView;
  onSelect: (view: BottomPanelView) => void;
  fx: ComponentProps<typeof FxPanel>;
  instrument: ComponentProps<typeof InstrumentPanel>;
  editor: ComponentProps<typeof TrackEditor>;
  edit: ComponentProps<typeof EditPanel>;
  mixer: ComponentProps<typeof MixerPanel>;
}

/** The panel below the timeline (on a phone: the body of the Track and Mixer tabs). Only the active
 * panel is mounted, so a hidden FX rack / Track Editor / Mixer costs nothing. */
export function Dock({ isPhone, views, active, onSelect, fx, instrument, editor, edit, mixer }: Props) {
  return (
    <div className="bottom-panel">
      {views.length > 0 && (
        <div className="bottom-panel-tabs">
          {views.map((view) => (
            <button key={view} className={`bottom-panel-tab ${active === view ? "active" : ""}`} onClick={() => onSelect(view)}>
              {dockLabel(view, isPhone)}
            </button>
          ))}
        </div>
      )}
      {active === "fx" && <FxPanel {...fx} />}
      {active === "instrument" && <InstrumentPanel {...instrument} />}
      {active === "editor" && <TrackEditor {...editor} />}
      {active === "edit" && <EditPanel {...edit} />}
      {active === "mixer" && <MixerPanel {...mixer} />}
    </div>
  );
}
