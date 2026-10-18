// The app's layout vocabulary in one place: which views exist, which breakpoint the viewport is
// in, and — as a pure function — what is actually showing for a given combination of view state.
// Everything about "where does this panel appear at this size" is decided here (and in the
// Chrome / Workspace components that render it); App.tsx only owns the state and the behaviour.
import { useMediaQuery } from "../hooks/useMediaQuery";

/** The side panel (left of the timeline) is tabbed so further views can be added later without
 * another layout change: add an entry here and a matching branch in SidePanel's content render.
 * Edit (clipboard + bar tools) lives here, beside the grid it acts on; on a phone it is the Track
 * tab's Edit sub-tab instead, and the phone's Library offers only Assets and MIDI. */
export type SidePanelView = "assets" | "midi" | "edit";
export const SIDE_PANEL_VIEWS: { id: SidePanelView; label: string }[] = [
  { id: "assets", label: "Assets" },
  { id: "midi", label: "MIDI" },
  { id: "edit", label: "Edit" },
];

/** The panel below the timeline switches between the Instrument editor and the FX rack (both
 * contextual to whatever's selected in the timeline), the Track Editor and the Mixer (all tracks at
 * once) — same tabbed pattern as the side panel. Instrument lives here, not on the track row,
 * because a track plays exactly one sound source: editing it in place keeps the track context the
 * sequencer is built around. "edit" is only ever a dock view on a phone (the Track tab's Edit
 * sub-tab); on desktop Edit lives in the side panel. */
export type BottomPanelView = "fx" | "instrument" | "editor" | "edit" | "mixer";
export const BOTTOM_PANEL_VIEWS: { id: BottomPanelView; label: string }[] = [
  { id: "instrument", label: "Instrument" },
  { id: "fx", label: "FX" },
  { id: "editor", label: "Track Editor" },
  { id: "edit", label: "Edit" },
  { id: "mixer", label: "Mixer" },
];

/** The dock's tabs on desktop, in order. */
export const DESKTOP_DOCK_VIEWS: BottomPanelView[] = ["instrument", "fx", "editor", "mixer"];

/** A phone-sized viewport has no room for the side panel and dock beside the timeline (see
 * index.css's `@media (max-width: 768px)` block, which shows exactly one section at a time), so
 * it gets one bottom tab bar of four: the Timeline, the selected track's editors (Track), the
 * Mixer, and the Library (Assets / Patterns / MIDI). This is pure navigation state — the
 * desktop's `sidePanelView`/`bottomPanelView` still own the content. */
export type MobileTab = "timeline" | "track" | "mixer" | "library";
export const MOBILE_TABS: { id: MobileTab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "track", label: "Track" },
  { id: "mixer", label: "Mixer" },
  { id: "library", label: "Library" },
];

/** The Track tab's sub-tabs: one fixed place for everything about the selected track, in a fixed
 * order. The choice persists while ◀ ▶ changes track, so a repeated edit across tracks stays put. */
export type TrackSubTab = "instrument" | "fx" | "editor" | "edit";
export const TRACK_SUB_TABS: { id: TrackSubTab; label: string }[] = [
  { id: "instrument", label: "Inst" },
  { id: "fx", label: "FX" },
  { id: "editor", label: "Notes" },
  { id: "edit", label: "Edit" },
];

export type LibraryView = "assets" | "patterns" | "midi";
export const LIBRARY_VIEWS: { id: LibraryView; label: string }[] = [
  { id: "assets", label: "Assets" },
  { id: "patterns", label: "Patterns" },
  { id: "midi", label: "MIDI" },
];

/** A phone view that takes the timeline's place instead of overlaying it: the pattern picker or ⋯
 * Settings. While one is up the grid is not rendered and its per-frame loops are paused — see
 * index.css's `data-takeover` rules. (Desktop has none: its pattern list is the Patterns view.) */
export type Takeover = "none" | "picker" | "settings";

/** Top-level toggle between the Sequencer workspace and the Patterns view (pattern library +
 * queue) — see index.css's `data-main-view` rules. The sequencer workspace stays mounted while the
 * Patterns view shows (only CSS `display` toggles), so switching never loses SequencerGrid's
 * scroll position/virtualization state. */
export type MainView = "sequencer" | "patterns";
export const MAIN_VIEWS: { id: MainView; label: string }[] = [
  { id: "sequencer", label: "Sequencer" },
  { id: "patterns", label: "Patterns" },
];

// --- breakpoints ---
//
// These are the ONLY breakpoints the JS knows about. index.css repeats the phone one in its
// `@media (max-width: 768px)` blocks (CSS cannot import a constant) — test/layout.test.ts fails if
// the two ever drift apart.

/** Phone layout: matches index.css's `@media (max-width: 768px)` block. */
export const PHONE_QUERY = "(max-width: 768px)";

export interface LayoutEnv {
  isPhone: boolean;
}

/** The viewport's breakpoint. The one hook in the app that reads media queries. */
export function useLayout(): LayoutEnv {
  return { isPhone: useMediaQuery(PHONE_QUERY) };
}

/** The view state that decides what shows where. */
export interface LayoutState {
  mobileTab: MobileTab;
  mainView: MainView;
  takeover: Takeover;
  bottomPanelView: BottomPanelView;
  trackSubTab: TrackSubTab;
  libraryView: LibraryView;
}

export interface DerivedLayout {
  /** The takeover actually in effect: on a phone only the Timeline tab has one; Settings is
   * phone-only. */
  takeover: Takeover;
  /** Nothing is showing in the timeline's place and the timeline's own view/tab is up — used to
   * pause the per-frame playhead / visible-column loops. */
  timelineVisible: boolean;
  /** The tabs the dock/Track-tab strip offers right now (empty on the phone's Mixer tab). */
  dockViews: BottomPanelView[];
  /** The panel the dock is showing. */
  activeDockView: BottomPanelView;
  /** The Patterns page is on screen (desktop: its top tab; phone: the Library's Patterns sub-tab). It
   * is mounted only then. */
  patternsVisible: boolean;
}

export function deriveLayout(env: LayoutEnv, state: LayoutState): DerivedLayout {
  const { isPhone } = env;
  // Only a phone's Timeline tab has a takeover; desktop has none.
  const takeover: Takeover = isPhone && state.mobileTab === "timeline" ? state.takeover : "none";
  const timelineVisible = takeover === "none" && (isPhone ? state.mobileTab === "timeline" : state.mainView === "sequencer");
  const dockViews: BottomPanelView[] = isPhone
    ? state.mobileTab === "mixer"
      ? []
      : TRACK_SUB_TABS.map((t) => t.id)
    : DESKTOP_DOCK_VIEWS;
  const activeDockView: BottomPanelView = isPhone
    ? state.mobileTab === "mixer"
      ? "mixer"
      : state.trackSubTab
    : dockViews.includes(state.bottomPanelView)
      ? state.bottomPanelView
      : "instrument";
  const patternsVisible = isPhone ? state.mobileTab === "library" && state.libraryView === "patterns" : state.mainView === "patterns";
  return { takeover, timelineVisible, dockViews, activeDockView, patternsVisible };
}

/** The side panel view actually shown: a phone never shows Edit there (it has its own sub-tab). */
export function effectiveSideView(env: LayoutEnv, view: SidePanelView): SidePanelView {
  return env.isPhone && view === "edit" ? "assets" : view;
}

/** Label for a dock tab: the phone's Track tab uses the short sub-tab names. */
export function dockLabel(view: BottomPanelView, isPhone: boolean): string {
  return (isPhone ? TRACK_SUB_TABS.find((t) => t.id === view)?.label : undefined) ?? BOTTOM_PANEL_VIEWS.find((v) => v.id === view)?.label ?? view;
}
