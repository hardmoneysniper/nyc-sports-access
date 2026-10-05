"use client";

// The foldable catalog that pops out from the left when "Show Menu" is
// clicked (per 2B.png) -- NOT a second vertical-rail sidebar. Lives next
// to MapPageSidebar (the real Data/About/Methodology rail, unchanged) and
// lists the 3 methodology sections as plain clickable rows; the selected
// row's content renders in the main content area to the right, same as
// before. Width matches 2B.png's catalog panel proportions. Per project
// owner instruction, 2026-10-05.
//
// The outer element here IS both the flex-basis-animated AND the
// overflow:hidden element -- that combination is what actually makes the
// panel visually collapse to 0 width when closed. (The "Show Menu"/"Hide
// Menu" button is rendered by the parent page, not here, specifically so
// it can sit outside this clipping box while still tracking this panel's
// open/closed edge -- putting the button inside this component once broke
// the collapse animation, since the button needed overflow:visible to
// stay on screen while closed, which then let the whole item list bleed
// out unclipped too.)
export type MethodologyTab = "travel-time" | "burden-score" | "data-source";

export const PANEL_WIDTH = 360;

const ITEMS: { id: MethodologyTab; label: string }[] = [
  { id: "travel-time", label: "Travel Time" },
  { id: "burden-score", label: "Burden Score" },
  { id: "data-source", label: "Data Source" },
];

export default function MethodologyMenuPanel({
  open,
  activeTab,
  onSelect,
}: {
  open: boolean;
  activeTab: MethodologyTab;
  onSelect: (tab: MethodologyTab) => void;
}) {
  return (
    <div
      style={{
        flex: `0 0 ${open ? PANEL_WIDTH : 0}px`,
        height: "100%",
        overflow: "hidden",
        background: "#000",
        borderRight: open ? "1px solid #333" : "none",
        transition: "flex-basis 300ms ease",
      }}
    >
      {/* Fixed-width inner wrapper so content doesn't reflow/squash while
          the outer flex-basis animates -- it just gets clipped/revealed. */}
      <div style={{ width: PANEL_WIDTH, height: "100%", paddingTop: 48 }}>
        {ITEMS.map((item) => {
          const isActive = item.id === activeTab;
          return (
            <div
              key={item.id}
              onClick={() => onSelect(item.id)}
              style={{
                padding: "22px 28px",
                borderBottom: "1px solid #333",
                background: isActive ? "#242424" : "transparent",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>{item.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
