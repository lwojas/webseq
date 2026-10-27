import type { ComponentProps } from "react";
import type { DerivedLayout, LayoutEnv } from "./layout";
import { Dock } from "./Dock";
import { SidePanel } from "./SidePanel";
import { ComposerTimeline } from "../components/ComposerTimeline";
import { PatternPicker } from "../components/PatternPicker";
import { ProjectBar } from "../components/ProjectBar";
import { SequencerGrid } from "../components/SequencerGrid";
import { TrackHeaderBar } from "../components/TrackHeaderBar";
import { TransportBar } from "../components/TransportBar";

interface Props {
  layout: LayoutEnv;
  derived: DerivedLayout;
  sidePanel: ComponentProps<typeof SidePanel>;
  grid: ComponentProps<typeof SequencerGrid>;
  composer: ComponentProps<typeof ComposerTimeline>;
  picker: ComponentProps<typeof PatternPicker>;
  settings: {
    projectName: string;
    onRenameProject: (name: string) => void;
    projectBar: ComponentProps<typeof ProjectBar>;
    transport: Omit<ComponentProps<typeof TransportBar>, "variant">;
  };
  /** The phone Track tab's header (play, ◀ track ▶, M, S). */
  trackHeader: ComponentProps<typeof TrackHeaderBar>;
  dock: Omit<ComponentProps<typeof Dock>, "isPhone" | "views" | "active">;
  mobileTab: string;
}

/** Side panel + main column. What is mounted where at each
 * breakpoint is decided here from `layout` / `derived`; App passes in already-wired props. */
export function Workspace({ layout, derived, sidePanel, grid, composer, picker, settings, trackHeader, dock, mobileTab }: Props) {
  const { isPhone } = layout;
  return (
    <div className="workspace">
      <SidePanel {...sidePanel} />

      <div className="main">
        {/* The two views of the same composition: the Composer takes the grid's place (it is not rendered
            beside or under it), and the surrounding dock, side panel and mixer stay. */}
        {derived.composerVisible ? <ComposerTimeline {...composer} /> : <SequencerGrid {...grid} />}

        {derived.takeover === "picker" && <PatternPicker {...picker} />}

        {isPhone && derived.takeover === "settings" && (
          <div className="settings-view">
            <label className="field">
              <span>Project</span>
              <input
                className="project-name-input settings-project-name"
                value={settings.projectName}
                onChange={(e) => settings.onRenameProject(e.target.value)}
              />
            </label>
            <ProjectBar {...settings.projectBar} />
            <TransportBar {...settings.transport} variant="settings" />
          </div>
        )}

        {isPhone && mobileTab === "track" && <TrackHeaderBar {...trackHeader} />}

        <Dock {...dock} isPhone={isPhone} views={derived.dockViews} active={derived.activeDockView} />
      </div>
    </div>
  );
}
