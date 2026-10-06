"use client";

import { useState } from "react";
import {
  DEMOGRAPHIC_CATEGORIES,
  SPORT_TYPES,
  type DemographicCategoryValue,
  type SportTypeValue,
} from "@/lib/selectionContext";

// The map page's foldable catalog -- structurally the same collapse
// mechanism as MethodologyMenuPanel (same PANEL_WIDTH, same flex-basis +
// overflow:hidden outer wrapper, "Show Menu"/"Hide Menu" rendered by the
// parent page for the same reason documented there), but ACCORDION content
// instead of flat rows: one section body is expanded (flex:1) at a time,
// which is what makes "Recreation Facility" and "Demographic" always occupy
// the same height regardless of which is open, and gives the not-yet-built
// "Featured Maps" section zero footprint once it's added later. Matches
// 2A.png. Per project owner instruction, 2026-10-05.
export const PANEL_WIDTH = 360;

type SectionId = "recreation" | "demographic";

function Chevron() {
  return (
    <svg width={12} height={8} viewBox="0 0 12 8" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M1 1.5L6 6.5L11 1.5" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DropdownField<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T | null;
  onChange: (value: T | null) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <div style={{ position: "relative", padding: "0 28px" }}>
      <select
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as T | null)}
        style={{
          width: "100%",
          appearance: "none",
          background: "transparent",
          color: "#fff",
          border: "none",
          borderBottom: "1px solid #666",
          padding: "8px 20px 8px 0",
          fontSize: 15,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {/* Plain, selectable (not disabled/hidden) -- picking it explicitly
            resets the map back to the blank state, same as never having
            chosen anything. Per project owner instruction, 2026-10-05. */}
        <option value="" style={{ color: "#000" }}>
          Select...
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ color: "#000" }}>
            {o.label}
          </option>
        ))}
      </select>
      <div style={{ position: "absolute", right: 28, top: 12, pointerEvents: "none" }}>
        <Chevron />
      </div>
    </div>
  );
}

// Body is always mounted (never conditionally rendered) and transitions
// via the flex-grow longhand -- flex-grow is independently animatable,
// unlike the "flex" shorthand or a plain mount/unmount, which is what
// makes the collapsed section's header+body smoothly slide out of the way
// instead of snapping instantly. Per project owner instruction, 2026-10-05.
function AccordionSection({
  title,
  active,
  onActivate,
  children,
}: {
  title: string;
  active: boolean;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: active ? 1 : 0,
        flexShrink: 0,
        flexBasis: "auto",
        minHeight: 0,
        transition: "flex-grow 300ms ease",
      }}
    >
      <div onClick={onActivate} style={{ padding: "22px 28px", cursor: "pointer", flexShrink: 0 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>{title}</span>
      </div>
      {/* flexBasis fixed at 0 (not "auto") -- with flexShrink:0 and a
          content-sized "auto" basis, flex-grow:0 only stops the item from
          GROWING, it never actually shrinks below the dropdown's natural
          height, so the inactive section's dropdown stayed visible the
          whole time. Reported live, 2026-10-05 ("don't show the dropdown
          of demographics until clicked"). */}
      <div
        style={{
          flexGrow: active ? 1 : 0,
          flexShrink: active ? 0 : 1,
          flexBasis: 0,
          minHeight: 0,
          overflow: "hidden",
          transition: "flex-grow 300ms ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function MapIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <path d="M3 6.5 9 4l6 2.5L21 4v14l-6 2.5L9 18l-6 2.5V6.5Z" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M9 4v14M15 6.5v14" />
    </svg>
  );
}

function ChartsIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <line x1="5" y1="20" x2="5" y2="10" strokeLinecap="round" />
      <line x1="12" y1="20" x2="12" y2="4" strokeLinecap="round" />
      <line x1="19" y1="20" x2="19" y2="14" strokeLinecap="round" />
    </svg>
  );
}

export default function MapMenuPanel({
  open,
  sportType,
  onSportTypeChange,
  demographicCategory,
  onDemographicCategoryChange,
}: {
  open: boolean;
  sportType: SportTypeValue | null;
  onSportTypeChange: (value: SportTypeValue | null) => void;
  demographicCategory: DemographicCategoryValue | null;
  onDemographicCategoryChange: (value: DemographicCategoryValue | null) => void;
}) {
  const [activeSection, setActiveSection] = useState<SectionId>("recreation");
  // Purely cosmetic -- neither button is wired to real map/charts behavior
  // yet. Per project owner instruction, 2026-10-05.
  const [activeButton, setActiveButton] = useState<"map" | "charts">("map");

  // The outer element here IS both the flex-basis-animated AND the
  // overflow:hidden element -- that combination is what actually makes the
  // panel visually collapse to 0 width when closed (same structure as
  // MethodologyMenuPanel; an earlier version of this component split that
  // across two nested divs, one fixed-width+overflow:hidden INSIDE one
  // flex-basis-animated-but-not-clipping one, so the inner fixed-width
  // content just bled out past the outer's shrinking box instead of ever
  // visually collapsing. Reported live, 2026-10-05: "the hide menu is not
  // really working.")
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
      <div style={{ width: PANEL_WIDTH, height: "100%", display: "flex", flexDirection: "column", paddingTop: 48 }}>
          <AccordionSection
            title="Recreation Facility"
            active={activeSection === "recreation"}
            onActivate={() => setActiveSection("recreation")}
          >
            <DropdownField
              value={sportType}
              onChange={onSportTypeChange}
              options={SPORT_TYPES}
            />
          </AccordionSection>

          <div style={{ borderTop: "1px solid #333" }} />

          <AccordionSection
            title="Demographic"
            active={activeSection === "demographic"}
            onActivate={() => setActiveSection("demographic")}
          >
            <DropdownField
              value={demographicCategory}
              onChange={onDemographicCategoryChange}
              options={DEMOGRAPHIC_CATEGORIES}
            />
          </AccordionSection>

          <div style={{ display: "flex", flexShrink: 0 }}>
            {(["map", "charts"] as const).map((id) => {
              const isActive = activeButton === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveButton(id)}
                  aria-label={id === "map" ? "Map" : "Charts"}
                  style={{
                    flex: 1,
                    height: 44,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isActive ? "#fff" : "transparent",
                    color: isActive ? "#000" : "#fff",
                    border: "none",
                    borderTop: "1px solid #333",
                    cursor: "pointer",
                  }}
                >
                  {id === "map" ? <MapIcon /> : <ChartsIcon />}
                </button>
              );
            })}
          </div>
      </div>
    </div>
  );
}
