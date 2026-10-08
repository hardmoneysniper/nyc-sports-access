"use client";

import { useState } from "react";
import MapPageSidebar, { SIDEBAR_WIDTH } from "@/components/MapPageSidebar";
import MethodologyMenuPanel, { PANEL_WIDTH, type MethodologyTab } from "@/components/methodology/MethodologyMenuPanel";
import TravelTimeTab from "@/components/methodology/TravelTimeTab";
import BurdenScoreTab from "@/components/methodology/BurdenScoreTab";
import DataSourceTab from "@/components/methodology/DataSourceTab";

const SHOW_MENU_FONT_SIZE = 13;

// Replaces the "‹"/"›" text glyphs the Hide/Show Menu button used to show
// -- a font glyph's visual weight isn't geometrically centered within its
// own character box, so the arrow read as off-center no matter how the
// surrounding flex row was aligned. An SVG path has no such ambiguity: it's
// centered by construction. Reported live, 2026-10-08 ("absolutely
// centrally align the arrows for hide menu and show menu buttons").
function MenuArrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width={8} height={12} viewBox="0 0 8 12" fill="none" aria-hidden style={{ display: "block" }}>
      <path
        d={direction === "left" ? "M6.5 1L1.5 6L6.5 11" : "M1.5 1L6.5 6L1.5 11"}
        stroke="#fff"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Leftmost rail is the SAME MapPageSidebar as the map page (Data/About/
// Methodology) -- not replaced. "Show Menu" (per 2B.png) pops out a
// separate foldable catalog listing Travel Time / Burden Score / Data
// Source; selecting one shows its content in the main pane. Each
// computational tab is told through a scroll-triggered worked example
// instead of abstract prose. Per project owner instruction, 2026-10-05.
//
// The "Show Menu"/"Hide Menu" button is rendered here, not inside
// MapPageSidebar or MethodologyMenuPanel, as a position:absolute sibling
// of both -- its `left` tracks the catalog panel's own right edge
// (SIDEBAR_WIDTH, or SIDEBAR_WIDTH + PANEL_WIDTH once open) and animates
// alongside it. Rendering it inside MethodologyMenuPanel instead required
// that panel's outer flex-basis-animated element to drop overflow:hidden
// so the button wouldn't get clipped while closed -- but that same
// overflow:hidden is what makes the panel's own collapse animation work,
// so the panel stopped visually collapsing. Per project owner
// instruction, 2026-10-05 ("it should always attach to the right edge of
// the pop-out catalog... and move with the pop-out catalog").
export default function MethodologyPage() {
  // Unfolded by default, matching the new map-page catalog. Per project
  // owner instruction, 2026-10-05.
  const [menuOpen, setMenuOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<MethodologyTab>("travel-time");

  return (
    <div style={{ position: "relative", height: "100vh", width: "100%", overflow: "hidden", display: "flex", background: "#000" }}>
      <MapPageSidebar />
      <MethodologyMenuPanel open={menuOpen} activeTab={activeTab} onSelect={setActiveTab} />
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        style={{
          position: "absolute",
          top: 0,
          left: SIDEBAR_WIDTH + (menuOpen ? PANEL_WIDTH : 0),
          transition: "left 300ms ease",
          zIndex: 1200,
          background: "#000",
          color: "#fff",
          // Matches the foldable catalog's own borders (its outer
          // borderRight and the divider between its sections), not an
          // unrelated stark white. Per project owner instruction,
          // 2026-10-08 ("the same as the borders for the demographic
          // tab").
          border: "1px solid #333",
          borderRadius: 2,
          padding: "8px 12px",
          fontSize: SHOW_MENU_FONT_SIZE,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
        }}
      >
        {menuOpen ? (
          <>
            <MenuArrow direction="left" />
            Hide Menu
          </>
        ) : (
          <>
            Show Menu
            <MenuArrow direction="right" />
          </>
        )}
      </button>
      <div style={{ flex: 1, height: "100%", overflowY: "auto", color: "#fff", padding: "64px 80px 120px" }}>
        {activeTab === "travel-time" && <TravelTimeTab />}
        {activeTab === "burden-score" && <BurdenScoreTab />}
        {activeTab === "data-source" && <DataSourceTab />}
      </div>
    </div>
  );
}
