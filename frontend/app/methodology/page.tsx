"use client";

import MenuTopBar from "@/components/MenuTopBar";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import MapPageSidebar, { SIDEBAR_WIDTH } from "@/components/MapPageSidebar";
import MethodologyMenuPanel, { PANEL_WIDTH, type MethodologyTab } from "@/components/methodology/MethodologyMenuPanel";
import TravelTimeTab from "@/components/methodology/TravelTimeTab";
import BurdenScoreTab from "@/components/methodology/BurdenScoreTab";
import DataSourceTab from "@/components/methodology/DataSourceTab";


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
  return <Suspense fallback={null}><MethodologyRoute /></Suspense>;
}

function MethodologyRoute() {
  const params = useSearchParams();
  const tab = params.get("tab");
  const initialTab: MethodologyTab = tab === "burden-score" || tab === "data-source" ? tab : "travel-time";
  return <MethodologyContent key={initialTab} initialTab={initialTab} />;
}

function MethodologyContent({ initialTab }: { initialTab: MethodologyTab }) {
  // Unfolded by default, matching the new map-page catalog. Per project
  // owner instruction, 2026-10-05.
  const [contentScrolled, setContentScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<MethodologyTab>(initialTab);

  return (
    <div style={{ position: "relative", height: "100vh", width: "100%", overflow: "hidden", display: "flex", background: "#000" }}>
      <MapPageSidebar />
      <MethodologyMenuPanel open={menuOpen} activeTab={activeTab} onSelect={setActiveTab} />
      <MenuTopBar
        compact={contentScrolled}
        open={menuOpen}
        left={SIDEBAR_WIDTH + (menuOpen ? PANEL_WIDTH : 0)}
        onToggle={() => setMenuOpen((value) => !value)}
      />
      {/* overscrollBehavior scoped to this specific internal scroll pane
          (not a global html/body rule) -- applying it globally (tried
          first) broke normal scrolling on the landing page entirely,
          which scrolls the document/body itself rather than an inner
          overflow:auto pane like this one. Per project owner instruction,
          2026-10-14 ("I can't scroll the landing page... only change that
          for the landing page to make it scrollable" [i.e. restrict the
          fix's scope back out of it]). */}
      <div onScroll={(event) => setContentScrolled(event.currentTarget.scrollTop > 0)} style={{ flex: 1, minWidth: 0, height: "100%", overflowY: "auto", overscrollBehavior: "none", color: "#fff", padding: "64px 80px 120px" }}>
        {activeTab === "travel-time" && <TravelTimeTab />}
        {activeTab === "burden-score" && <BurdenScoreTab />}
        {activeTab === "data-source" && <DataSourceTab />}
      </div>
    </div>
  );
}
