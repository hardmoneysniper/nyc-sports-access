"use client";

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/basePath";
import { DropdownField } from "./MapMenuPanel";
import type { SportTypeValue } from "@/lib/selectionContext";

// Dashboard view (2D.png) -- toggled via the map page's own "map"/"charts"
// icon buttons (see app/explore/page.tsx). Three ranked, 1-dimensional bar
// charts (Access Burden Score, Average Travel Time, Population Density),
// clicking a bar highlights it and the same NTA's bar in the other two
// charts while dimming everything else. The master NTA set is every NTA
// with a positive Access Burden Score (i.e. actually underserved for the
// current sport), optionally further narrowed to one borough -- either
// way, all three charts rank that exact same set rather than independently
// dropping whichever ones happen to be missing their OWN metric, so row
// counts always match across all three. Per project owner instruction,
// 2026-10-14 ("Align the NTAs shown in the population density diagram with
// the other travel times... show all ntas with burden score > 0 and match
// the ntas being displayed in average travel time and population
// density"; "bring the borough option back but still keep the amounts
// aligned").

type BoroughCode = "MN" | "BX" | "BK" | "QN" | "SI";

const BOROUGHS: { value: BoroughCode; label: string }[] = [
  { value: "MN", label: "Manhattan" },
  { value: "BX", label: "Bronx" },
  { value: "BK", label: "Brooklyn" },
  { value: "QN", label: "Queens" },
  { value: "SI", label: "Staten Island" },
];

// NTA2020 codes are prefixed by borough (e.g. "QN0401") -- there's no
// separate Borough column in any of the exported datasets, so this is
// derived rather than looked up.
function boroughOf(ntaCode: string): BoroughCode | null {
  const prefix = ntaCode.slice(0, 2);
  return BOROUGHS.some((b) => b.value === prefix) ? (prefix as BoroughCode) : null;
}

// NYC NTA names are often hyphenated compounds of several sub-
// neighborhoods (e.g. "Breezy Point-Belle Harbor-Rockaway Park-Broad
// Channel") -- long enough to push the status box's text to 3 lines.
// Keeping just the first name reliably keeps it to 2 lines while still
// identifying the neighborhood. Per project owner instruction, 2026-10-14.
function shortenNtaName(name: string): string {
  return name.split("-")[0];
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

type NtaRecord = { ntaCode: string; name: string; borough: BoroughCode | null; density: number | null; burden: number | null; travelTime: number | null };

function useNtaData(sportType: SportTypeValue) {
  const [records, setRecords] = useState<NtaRecord[] | null>(null);
  const effectiveSport = sportType;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(withBasePath("/data/demographics.geojson")).then((r) => r.json()),
      fetch(withBasePath("/data/burden_index.geojson")).then((r) => r.json()),
      fetch(withBasePath("/data/travel_time.geojson")).then((r) => r.json()),
    ]).then(([demo, burden, travel]: GeoJSON.FeatureCollection[]) => {
      if (cancelled) return;
      const burdenByNta = new Map<string, number | null>();
      for (const f of burden.features) {
        const id = f.properties?.NTA2020 as string;
        const v = f.properties?.[`burden_index_${effectiveSport}`] as number | null | undefined;
        burdenByNta.set(id, typeof v === "number" ? v : null);
      }
      const travelByNta = new Map<string, number | null>();
      for (const f of travel.features) {
        const id = f.properties?.NTA2020 as string;
        const v = f.properties?.[`travel_time_${effectiveSport}`] as number | null | undefined;
        travelByNta.set(id, typeof v === "number" ? v : null);
      }
      const parsed: NtaRecord[] = demo.features.map((f) => {
        const ntaCode = f.properties?.NTA2020 as string;
        const density = f.properties?.density as number | null | undefined;
        return {
          ntaCode,
          name: (f.properties?.NTAName as string) ?? ntaCode,
          borough: boroughOf(ntaCode),
          density: typeof density === "number" ? density : null,
          burden: burdenByNta.get(ntaCode) ?? null,
          travelTime: travelByNta.get(ntaCode) ?? null,
        };
      });
      setRecords(parsed);
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveSport]);

  return records;
}

type TooltipState = { name: string; x: number; y: number } | null;

const BAR_HEIGHT = 11;

function RankedBarChart({
  title,
  bars,
  selectedNta,
  formatValue,
  onSelect,
  onHover,
}: {
  title: string;
  bars: { ntaCode: string; name: string; value: number }[];
  selectedNta: string | null;
  // Shown next to the selected bar only -- unselected bars stay a plain
  // comparative ranking with no label, same as before. Per project owner
  // instruction, 2026-10-14 ("show only the data of this indicator").
  formatValue: (value: number) => string;
  onSelect: (ntaCode: string) => void;
  onHover: (info: TooltipState) => void;
}) {
  const max = Math.max(...bars.map((b) => b.value), 1);

  return (
    <div style={{ flex: "1 1 192px", minWidth: 160 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "#fff", margin: 0 }}>{title}</h3>
      <div style={{ marginTop: 16, borderLeft: "1px solid #666", paddingLeft: 8 }}>
        {bars.map((bar) => {
          const isSelected = selectedNta === bar.ntaCode;
          const dimmed = selectedNta !== null && !isSelected;
          return (
            <div
              key={bar.ntaCode}
              onClick={() => onSelect(bar.ntaCode)}
              // Keep all hover stats hidden while any NTA is selected.
              onMouseMove={selectedNta !== null ? undefined : (e) => onHover({ name: shortenNtaName(bar.name), x: e.clientX, y: e.clientY })}
              onMouseLeave={selectedNta !== null ? undefined : () => onHover(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                // Constant height regardless of selection -- doubling it
                // when selected (tried first, per an earlier instruction)
                // read as the bar visually "bolding"/thickening on click,
                // which turned out to be the effect being reported as
                // unwanted across several follow-ups ("remove the bold
                // effect when clicked"; "remove the hovering-the-bar
                // effect after clicking"; "the click-to-bold-bar effect is
                // still there"). Selection is still conveyed via full
                // opacity (vs. dimmed siblings) and the value label below.
                // Per project owner instruction, 2026-10-14.
                height: BAR_HEIGHT,
                marginBottom: 4,
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  height: "100%",
                  // *0.8 -- every bar's length scaled down 20%
                  // proportionally (rankings/relative lengths unchanged,
                  // the longest bar now reaches 80% instead of 100%). Per
                  // project owner instruction, 2026-10-14.
                  width: `${Math.max((bar.value / max) * 100 * 0.8, 1)}%`,
                  background: "#ddd",
                  opacity: dimmed ? 0.25 : 1,
                  transition: "opacity 150ms ease",
                }}
              />
              {isSelected && <span style={{ fontSize: 13, color: "#fff", whiteSpace: "nowrap" }}>{formatValue(bar.value)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardView({ sportType }: { sportType: SportTypeValue | null }) {
  if (!sportType) {
    return (
      <div style={{ height: "100%", overflowY: "auto", scrollbarGutter: "stable", padding: "40px 80px 120px", color: "#fff" }}>
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Select a sports facility to view the charts</h2>
        </div>
      </div>
    );
  }

  return <SelectedFacilityDashboard sportType={sportType} />;
}

function SelectedFacilityDashboard({ sportType }: { sportType: SportTypeValue }) {
  const records = useNtaData(sportType);
  const [borough, setBorough] = useState<BoroughCode | null>(null);
  const [selectedNta, setSelectedNta] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  // The master set every chart ranks from: NTAs with a positive Access
  // Burden Score (burden <= 0 means "at or above expected," not actually
  // underserved), a non-zero population density (an NTA with 0 density has
  // no residents to weight a burden score by in the first place -- almost
  // certainly a park/airport/cemetery-type NTA, not a real neighborhood),
  // and data present for all three metrics -- a positive burden score is
  // only computed when both travelTime and density were already available,
  // so this filter alone is what keeps the three charts' row counts
  // identical, not three independent per-metric filters -- then optionally
  // narrowed to one borough, still as a single shared filter feeding all
  // three charts (not three separate borough filters), so the row counts
  // stay aligned either way. Per project owner instruction, 2026-10-14
  // ("remove all ntas with 0 population density and the corresponding rows
  // in the other 2 diagrams").
  const underserved = useMemo(
    () =>
      (records ?? []).filter(
        (r) =>
          typeof r.burden === "number" &&
          r.burden > 0 &&
          typeof r.travelTime === "number" &&
          typeof r.density === "number" &&
          r.density > 0 &&
          (borough === null || r.borough === borough)
      ),
    [records, borough]
  );

  const burdenBars = useMemo(
    () => underserved.map((r) => ({ ntaCode: r.ntaCode, name: r.name, value: r.burden as number })).sort((a, b) => b.value - a.value),
    [underserved]
  );
  const travelBars = useMemo(
    () => underserved.map((r) => ({ ntaCode: r.ntaCode, name: r.name, value: r.travelTime as number })).sort((a, b) => b.value - a.value),
    [underserved]
  );
  const densityBars = useMemo(
    () => underserved.map((r) => ({ ntaCode: r.ntaCode, name: r.name, value: r.density as number })).sort((a, b) => b.value - a.value),
    [underserved]
  );

  const handleSelect = (ntaCode: string) => {
    setSelectedNta((prev) => (prev === ntaCode ? null : ntaCode));
    // Selecting a bar disables all chart hover handlers from here on (see
    // RankedBarChart), so without this the tooltip set by whatever hover
    // triggered the click would otherwise stick on screen forever --
    // onMouseLeave never fires again to clear it once disabled.
    setTooltip(null);
  };

  // "xth worst"/"xth largest" -- 1-indexed position in each already
  // descending-sorted array, since all three already rank worst/largest
  // first. The NTA name and each ranking are bolded (<strong>), the rest
  // of the sentence stays regular weight. Per project owner instruction,
  // 2026-10-14 ("bold these text in the status box... NTA name,
  // rankings").
  const rankSummary = useMemo(() => {
    if (!selectedNta) return null;
    const burdenRank = burdenBars.findIndex((b) => b.ntaCode === selectedNta);
    const travelRank = travelBars.findIndex((b) => b.ntaCode === selectedNta);
    const densityRank = densityBars.findIndex((b) => b.ntaCode === selectedNta);
    if (burdenRank === -1 || travelRank === -1 || densityRank === -1) return null;
    const name = shortenNtaName(burdenBars[burdenRank].name);
    return (
      <>
        <strong>{name}</strong> ranks <strong>{ordinal(burdenRank + 1)}</strong> worst in Access Burden Score,{" "}
        <strong>{ordinal(travelRank + 1)}</strong> worst in Average Travel time, and{" "}
        <strong>{ordinal(densityRank + 1)}</strong> largest in population density
      </>
    );
  }, [selectedNta, burdenBars, travelBars, densityBars]);

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        // Reserves the scrollbar's own width whether or not it's actually
        // needed -- different boroughs have very different numbers of
        // qualifying NTAs, so a borough with enough rows to need
        // scrolling was rendering its content (status box width, the 3
        // diagrams' positions) a scrollbar's-width narrower than a
        // borough short enough to fit without one. Per project owner
        // instruction, 2026-10-14 ("Keep the positions of these 3
        // diagrams and the width of the box consistent across all
        // borough views").
        scrollbarGutter: "stable",
        padding: "40px 80px 120px",
        color: "#fff",
      }}
    >
      {/* Right-half info box: was alignItems:"stretch" (matching the left
          column's OWN current height), which matched "Borough"/the
          dropdown's bottom exactly while the dropdown was closed, but then
          also grew every time it was OPENED, since the left column's
          natural height balloons to fit its full option list -- the box
          visibly expanded and shrank as the dropdown toggled. A fixed
          height (on the box itself, see below) decouples the two: it's
          sized once to roughly match the dropdown's closed height, not
          recalculated from the sibling's current DOM state. Per project
          owner instruction, 2026-10-14 ("don't expand when the dropdown
          menu is expanded"). */}
      <div style={{ display: "flex", gap: 32, marginTop: 32, alignItems: "flex-start" }}>
        <div style={{ flex: "0 0 50%" }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Borough</h2>
          <div style={{ maxWidth: 320, marginTop: 8 }}>
            <DropdownField value={borough} onChange={setBorough} options={BOROUGHS} placeholder="Select borough..." horizontalPadding={0} floatList />
          </div>
        </div>
        <div style={{ flex: "0 0 50%" }}>
          {/* Only rendered once a borough is picked -- shown blank
              otherwise, not a filler box with placeholder copy (tried
              first). Per project owner instruction, 2026-10-14 ("Don't
              show the box when a borough is not selected"). */}
          {borough && (
            <div
              style={{
                // Fixed (not a percentage/stretched height) -- matches 2
                // lines of the box's own 15px/1.5 text (2 * 15*1.5 = 45px)
                // plus its own 16px top+bottom padding, and stays this size
                // regardless of how many lines THIS PARTICULAR NTA's name/
                // sentence happens to wrap to, or whether the Borough
                // dropdown beside it is open or closed. Per project owner
                // instruction, 2026-10-14 ("Keep the size of the box always
                // the same as when it has 2 lines of content"; "don't
                // expand when the dropdown menu is expanded").
                height: 77,
                boxSizing: "border-box",
                border: "1px solid #444",
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: rankSummary ? "flex-start" : "center",
                color: "#fff",
              }}
            >
            {/* A single plain <p>, not the raw fragment, as the flex
                container's only child -- direct children of a flex
                container are each blockified into their own flex item,
                which broke rankSummary's mixed text/<strong> nodes into
                separate lines instead of one flowing sentence. Reported
                live, 2026-10-14 ("it is not even on a single line"). */}
            <p
              style={{
                margin: 0,
                fontSize: 15,
                lineHeight: 1.5,
                textAlign: rankSummary ? "left" : "center",
                color: rankSummary ? "#fff" : "#777",
              }}
            >
              {rankSummary ?? "Select a neighborhood from the chart below by clicking on a bar to reveal its data and rankings in its Borough"}
            </p>
            </div>
          )}
        </div>
      </div>

      {borough && (
        <>
          <div style={{ display: "flex", gap: 64, marginTop: 48, flexWrap: "wrap" }}>
            <RankedBarChart
              title="Access Burden Score"
              bars={burdenBars}
              selectedNta={selectedNta}
              formatValue={(v) => v.toFixed(1)}
              onSelect={handleSelect}
              onHover={setTooltip}
            />
            <RankedBarChart
              title="Average Travel Time"
              bars={travelBars}
              selectedNta={selectedNta}
              formatValue={(v) => `${v.toFixed(1)} min`}
              onSelect={handleSelect}
              onHover={setTooltip}
            />
            <RankedBarChart
              title="Population Density"
              bars={densityBars}
              selectedNta={selectedNta}
              formatValue={(v) => `${Math.round(v).toLocaleString()}/sqmi`}
              onSelect={handleSelect}
              onHover={setTooltip}
            />
          </div>
          {/* Moved below the diagrams, matching the diagram titles' own
              font size, with a leading asterisk (a footnote, not a lead-in
              sentence). Per project owner instruction, 2026-10-14. */}
          <p style={{ fontSize: 14, color: "#ccc", margin: 0, marginTop: 24 }}>
            *Only NTAs with Access Burden Score &gt; 0 is shown here.
          </p>
        </>
      )}

      {tooltip && selectedNta === null && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x + 14,
            top: tooltip.y + 14,
            zIndex: 1000,
            background: "#fff",
            color: "#111",
            padding: "6px 10px",
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 700,
            pointerEvents: "none",
            boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
            whiteSpace: "nowrap",
          }}
        >
          {tooltip.name}
        </div>
      )}
    </div>
  );
}
