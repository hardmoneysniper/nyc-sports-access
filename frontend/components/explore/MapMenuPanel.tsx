"use client";

import { useEffect, useRef, useState } from "react";
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
// 20% narrower than the original 360. Per project owner instruction,
// 2026-10-08.
export const PANEL_WIDTH = 288;

type SectionId = "recreation" | "demographic";

function Chevron({ direction = "down" }: { direction?: "down" | "up" }) {
  return (
    <svg
      width={12}
      height={8}
      viewBox="0 0 12 8"
      fill="none"
      aria-hidden
      style={{ flexShrink: 0, transform: direction === "up" ? "rotate(180deg)" : "none" }}
    >
      <path d="M1 1.5L6 6.5L11 1.5" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Custom listbox (not a native <select>) -- matches 2B.png's design, which
// expands the option list inline below the label row (dark grey panel,
// white rows) rather than relying on the browser's own native dropdown
// popup, which can't be restyled this way and can't flip its own disclosure
// arrow on open/close. Per project owner instruction, 2026-10-08 ("change
// the downward arrow to upward arrow... make the style of the dropdown
// menu consistent with the design in 2B.png").
function DropdownField<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Select...",
}: {
  value: T | null;
  onChange: (value: T | null) => void;
  options: readonly { value: T; label: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const pick = (v: T | null) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={rootRef} style={{ padding: "0 28px" }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          borderBottom: "1px solid #666",
          padding: "8px 0",
          fontSize: 15,
          fontWeight: 600,
          color: "#fff",
          cursor: "pointer",
        }}
      >
        <span>{value === null ? placeholder : selectedLabel}</span>
        <Chevron direction={open ? "up" : "down"} />
      </div>
      {/* Sized to content, no maxHeight/scroll -- a flex:1-stretched box
          filled the accordion body's entire available height regardless of
          option count, leaving a tall blank strip below short lists
          (Demographic has only 6). A maxHeight cap fixed that but clipped
          the sport list's full 20 options behind a scrollbar; dropped
          entirely so every option is always visible at once. Reported
          live, 2026-10-08 ("make all option show at once"). */}
      {open && (
        <div style={{ background: "#242424", paddingBottom: 5 }}>
          {/* paddingLeft, not a literal leading space character -- a plain
              " " gets collapsed away entirely by the browser's own
              white-space:normal rules regardless of how it got into the
              text, and even a non-collapsing non-breaking space is too
              subtle to read as a deliberate indent at this font size.
              Reported live, 2026-10-08 ("I didn't see a space in front of
              each option"). */}
          <div onClick={() => pick(null)} style={{ padding: "5px 0 5px 8px", fontSize: 13, color: "#fff", cursor: "pointer" }}>
            {placeholder}
          </div>
          {options.map((o) => (
            <div key={o.value} onClick={() => pick(o.value)} style={{ padding: "5px 0 5px 8px", fontSize: 13, color: "#fff", cursor: "pointer" }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
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
      <div style={{ width: PANEL_WIDTH, height: "100%", display: "flex", flexDirection: "column" }}>
          <AccordionSection
            title="Access Burden Score"
            active={activeSection === "recreation"}
            onActivate={() => setActiveSection("recreation")}
          >
            <DropdownField
              value={sportType}
              onChange={onSportTypeChange}
              options={SPORT_TYPES}
              placeholder="Select sports facility"
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
