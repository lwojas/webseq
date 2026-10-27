import type { ComponentProps } from "react";
import { LIBRARY_VIEWS, MAIN_VIEWS, type LayoutEnv, type LibraryView, type MainView, type MobileTab } from "./layout";
import { MobileTopBar } from "../components/MobileTopBar";
import { PatternStrip } from "../components/PatternStrip";
import { ProjectBar } from "../components/ProjectBar";
import { TransportBar } from "../components/TransportBar";

interface Props {
  layout: LayoutEnv;
  mainView: MainView;
  onSelectMainView: (view: MainView) => void;
  mobileTab: MobileTab;
  libraryView: LibraryView;
  onSelectLibraryView: (view: LibraryView) => void;
  projectName: string;
  onRenameProject: (name: string) => void;
  /** "16 beats / 1 bar" for the edited pattern. */
  subtitle: string;
  projectBar: ComponentProps<typeof ProjectBar>;
  transport: Omit<ComponentProps<typeof TransportBar>, "variant">;
  patternStrip: ComponentProps<typeof PatternStrip>;
  mobileTopBar: ComponentProps<typeof MobileTopBar>;
}

/** Everything above the workspace. The desktop gets the top bar (project, tabs), the transport row
 * and the pattern strip; a phone gets ONE 44px top bar on the Timeline tab and the Library's
 * sub-tabs on the Library tab. Which one is a layout decision made here, from `layout`, so App
 * never branches on breakpoints in its own render. */
export function Chrome({
  layout,
  mainView,
  onSelectMainView,
  mobileTab,
  libraryView,
  onSelectLibraryView,
  projectName,
  onRenameProject,
  subtitle,
  projectBar,
  transport,
  patternStrip,
  mobileTopBar,
}: Props) {
  if (layout.isPhone) {
    if (mobileTab === "timeline") return <MobileTopBar {...mobileTopBar} />;
    if (mobileTab === "library") {
      return (
        <nav className="library-tabs">
          {LIBRARY_VIEWS.map((view) => (
            <button key={view.id} className={`library-tab ${libraryView === view.id ? "active" : ""}`} onClick={() => onSelectLibraryView(view.id)}>
              {view.label}
            </button>
          ))}
        </nav>
      );
    }
    return null;
  }

  return (
    <>
      <div className="topbar">
        <div>
          <span className="brand">WEBSEQ</span>
          <input className="project-name-input" value={projectName} onChange={(e) => onRenameProject(e.target.value)} />
        </div>
        <ProjectBar {...projectBar} />
        <div className="topbar-right">
          <div className="subtitle">{subtitle}</div>
          <nav className="top-tabs" aria-label="View">
            {MAIN_VIEWS.map((view) => (
              <button
                key={view.id}
                className={`top-tab ${mainView === view.id ? "active" : ""}`}
                aria-current={mainView === view.id ? "page" : undefined}
                onClick={() => onSelectMainView(view.id)}
              >
                {view.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
      <TransportBar {...transport} variant="bar" />
      {/* The strip is about the pattern open in the grid; the Composer replaces the grid, so it has no strip. */}
      {mainView !== "composer" && <PatternStrip {...patternStrip} />}
    </>
  );
}
