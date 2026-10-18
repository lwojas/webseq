import { MOBILE_TABS, type MobileTab } from "./layout";

interface Props {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
}

/** The phone's bottom tab bar (hidden on desktop by CSS): the one control that switches between
 * Timeline / Track / Mixer / Library. */
export function MobileTabBar({ active, onSelect }: Props) {
  return (
    <nav className="mobile-tabbar">
      {MOBILE_TABS.map((tab) => (
        <button key={tab.id} className={`mobile-tab ${active === tab.id ? "active" : ""}`} onClick={() => onSelect(tab.id)}>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
