"use client";

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/basePath";
import { DEMOGRAPHIC_CATEGORIES, SPORT_TYPES, type DemographicCategoryValue, type SportTypeValue } from "@/lib/selectionContext";

// New chart-view page shown once BOTH a sport and a demographic category
// are selected (replacing DashboardView's 3-bar-chart view, which only
// covers a single sport) -- one scatterplot, each point an NTA, Access Gap
// (x) vs. the selected demographic's % (y). Styled to match the
// methodology page's ScatterPlot (black background, white axes/points,
// same font sizes/padding) -- duplicated rather than importing that
// component directly, since ScatterPlot is tightly coupled to the Burden
// Score tab's own highlight/residual/expected-point annotations, none of
// which apply here. Per project owner instruction, 2026-11-02.
//
// Plots access_gap_{sport} (export_dashboard_data.py's
// export_access_gap(), the raw/signed/unweighted travel-time residual),
// NOT burden_index_{sport} -- burden_index's population weighting and
// floor-at-0 buried almost every sport/demographic relationship (soccer
// vs. immigrant % was r=0.04 against burden_index); refit against the
// unweighted residual it strengthened to 27 of 126 pairs at |r| >= 0.3 (see
// check_positive_residual_demographic_regressions.py). Points are further
// filtered to access_gap > 0 only -- an NTA at or below its density-
// predicted travel time isn't "underserved," and keeping it at exactly 0
// would pile a large fraction of NTAs on the y-axis for no analytical
// reason. Per project owner instruction, 2026-11-02 ("use the residual,
// only keep positive values... Only keep non-zero points").

type BoroughCode = "MN" | "BX" | "BK" | "QN" | "SI";

// Same palette and borough names as
// make_scatter_foreign_born_vs_soccer_avg_travel_time_by_borough.py (the
// "5 borough scatterplot used in the article") -- reused exactly, not
// re-derived, so a borough means the same color here as it does there.
const BOROUGH_COLORS: Record<BoroughCode, string> = {
  MN: "#4daf4a",
  BK: "#377eb8",
  QN: "#984ea3",
  BX: "#e41a1c",
  SI: "#ff7f00",
};

const BOROUGHS: { value: BoroughCode; label: string }[] = [
  { value: "MN", label: "Manhattan" },
  { value: "BK", label: "Brooklyn" },
  { value: "QN", label: "Queens" },
  { value: "BX", label: "Bronx" },
  { value: "SI", label: "Staten Island" },
];

// NTA2020 codes are prefixed by borough -- same derivation DashboardView
// already uses, no separate Borough column needed.
function boroughOf(ntaCode: string): BoroughCode | null {
  const prefix = ntaCode.slice(0, 2);
  return BOROUGHS.some((b) => b.value === prefix) ? (prefix as BoroughCode) : null;
}

type NtaPoint = { ntaCode: string; borough: BoroughCode | null; accessGap: number; demographicPct: number };

type RegressionEntry = { slope: number; intercept: number; r: number; n: number };
type Regressions = Record<string, Record<string, RegressionEntry>>;

function useScatterData(sportType: SportTypeValue, demographicCategory: DemographicCategoryValue) {
  const [points, setPoints] = useState<NtaPoint[] | null>(null);
  const [regressions, setRegressions] = useState<Regressions | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(withBasePath("/data/demographics.geojson")).then((r) => r.json()),
      fetch(withBasePath("/data/access_gap.geojson")).then((r) => r.json()),
      fetch(withBasePath("/data/access_gap_demographic_regressions.json")).then((r) => r.json()),
    ]).then(([demo, gaps, regr]: [GeoJSON.FeatureCollection, GeoJSON.FeatureCollection, Regressions]) => {
      if (cancelled) return;
      const gapByNta = new Map<string, number>();
      for (const f of gaps.features) {
        const id = f.properties?.NTA2020 as string;
        const v = f.properties?.[`access_gap_${sportType}`] as number | null | undefined;
        // > 0 only -- an NTA at or below its density-predicted travel time
        // isn't underserved, and keeping those (or the exact-0 cutoff
        // point) would pile a large share of NTAs on the y-axis with no
        // analytical meaning. Per project owner instruction, 2026-11-02.
        if (typeof v === "number" && v > 0) gapByNta.set(id, v);
      }
      const parsed: NtaPoint[] = [];
      for (const f of demo.features) {
        const ntaCode = f.properties?.NTA2020 as string;
        const gapValue = gapByNta.get(ntaCode);
        const demoValue = f.properties?.[demographicCategory] as number | null | undefined;
        if (typeof gapValue === "number" && typeof demoValue === "number") {
          parsed.push({ ntaCode, borough: boroughOf(ntaCode), accessGap: gapValue, demographicPct: demoValue });
        }
      }
      setPoints(parsed);
      setRegressions(regr);
    });
    return () => {
      cancelled = true;
    };
  }, [sportType, demographicCategory]);

  return { points, regressions };
}

function niceTicks(domain: [number, number], count: number): number[] {
  const [lo, hi] = domain;
  const step = (hi - lo) / (count - 1);
  return Array.from({ length: count }, (_, i) => lo + step * i);
}

const PAD_LEFT = 64;
const PAD_BOTTOM = 48;
const PAD_TOP = 24;
const PAD_RIGHT = 24;

function Scatter({
  points,
  xLabel,
  yLabel,
  fittedLine,
  showLine,
  selectedBorough,
}: {
  points: NtaPoint[];
  xLabel: string;
  yLabel: string;
  fittedLine: RegressionEntry | null;
  showLine: boolean;
  selectedBorough: BoroughCode | null;
}) {
  const width = 760;
  const height = 520;
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;

  const xDomain = useMemo<[number, number]>(() => {
    // Always starts at 0 -- points are already filtered to accessGap > 0
    // upstream (see useScatterData), so there's no negative range to show.
    const values = points.map((p) => p.accessGap);
    const hi = Math.max(...values, 1);
    return [0, hi * 1.05];
  }, [points]);
  const yDomain = useMemo<[number, number]>(() => {
    const values = points.map((p) => p.demographicPct);
    return [0, Math.max(...values, 1) * 1.05];
  }, [points]);

  const sx = (x: number) => PAD_LEFT + ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotW;
  const sy = (y: number) => PAD_TOP + plotH - ((y - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotH;

  const xTicks = niceTicks(xDomain, 5);
  const yTicks = niceTicks(yDomain, 5);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ display: "block", width: "100%", height: "auto", background: "#000" }}>
      <line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={PAD_TOP + plotH} stroke="#fff" strokeOpacity={0.4} />
      <line x1={PAD_LEFT} y1={PAD_TOP + plotH} x2={PAD_LEFT + plotW} y2={PAD_TOP + plotH} stroke="#fff" strokeOpacity={0.4} />
      {xTicks.map((t) => (
        <text key={`xt-${t}`} x={sx(t)} y={PAD_TOP + plotH + 18} fill="#fff" fillOpacity={0.6} fontSize={11} textAnchor="middle">
          {t.toFixed(0)}
        </text>
      ))}
      {yTicks.map((t) => (
        <text key={`yt-${t}`} x={PAD_LEFT - 8} y={sy(t) + 4} fill="#fff" fillOpacity={0.6} fontSize={11} textAnchor="end">
          {t.toFixed(0)}
        </text>
      ))}
      <text x={PAD_LEFT + plotW / 2} y={height - 8} fill="#fff" fontSize={13} textAnchor="middle">
        {xLabel}
      </text>
      <text
        x={18}
        y={PAD_TOP + plotH / 2}
        fill="#fff"
        fontSize={13}
        textAnchor="middle"
        transform={`rotate(-90, 18, ${PAD_TOP + plotH / 2})`}
      >
        {yLabel}
      </text>

      {showLine && fittedLine && (
        <line
          x1={sx(xDomain[0])}
          y1={sy(fittedLine.intercept + fittedLine.slope * xDomain[0])}
          x2={sx(xDomain[1])}
          y2={sy(fittedLine.intercept + fittedLine.slope * xDomain[1])}
          stroke="#fff"
          strokeWidth={1.5}
        />
      )}

      {points.map((p) => {
        // No borough selected: every point plain white. A borough
        // selected: that borough's points take its color (from the same
        // palette as the article's borough scatter), everything else
        // dims to a flat dark gray -- not a dimmed white, a genuinely
        // different (darker) color, per project owner instruction
        // ("others dim without color"/"dim to a darker color").
        const isSelectedBorough = selectedBorough !== null && p.borough === selectedBorough;
        const isDimmed = selectedBorough !== null && !isSelectedBorough;
        const fill = isSelectedBorough ? BOROUGH_COLORS[selectedBorough] : isDimmed ? "#444" : "#fff";
        return <circle key={p.ntaCode} cx={sx(p.accessGap)} cy={sy(p.demographicPct)} r={3} fill={fill} fillOpacity={isDimmed ? 0.7 : 0.85} />;
      })}
    </svg>
  );
}

export default function BurdenDemographicScatter({
  sportType,
  demographicCategory,
}: {
  sportType: SportTypeValue;
  demographicCategory: DemographicCategoryValue;
}) {
  const { points, regressions } = useScatterData(sportType, demographicCategory);
  const [showLine, setShowLine] = useState(false);
  const [selectedBorough, setSelectedBorough] = useState<BoroughCode | null>(null);

  const sportLabel = SPORT_TYPES.find((s) => s.value === sportType)?.label ?? sportType;
  const demographicLabel = DEMOGRAPHIC_CATEGORIES.find((c) => c.value === demographicCategory)?.label ?? demographicCategory;

  const fittedLine = regressions?.[sportType]?.[demographicCategory] ?? null;

  if (!points) {
    return (
      <div style={{ height: "100%", overflowY: "auto", padding: "40px 80px 120px", color: "#fff" }}>
        <p style={{ color: "#777", marginTop: 40 }}>Loading data…</p>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", scrollbarGutter: "stable", padding: "40px 80px 120px", color: "#fff" }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
        Access Gap vs. {demographicLabel} — {sportLabel}
      </h2>
      <p style={{ fontSize: 14, color: "#ccc", marginTop: 8 }}>
        Each point is one NTA with worse-than-expected access (travel time above what its density predicts). {points.length} NTAs shown.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 24, marginTop: 20, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: fittedLine ? "pointer" : "default", opacity: fittedLine ? 1 : 0.4 }}>
          <input type="checkbox" checked={showLine} disabled={!fittedLine} onChange={(e) => setShowLine(e.target.checked)} />
          Show fitted trend line
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: "#aaa" }}>Borough:</span>
          {BOROUGHS.map((b) => {
            const active = selectedBorough === b.value;
            return (
              <button
                key={b.value}
                onClick={() => setSelectedBorough((prev) => (prev === b.value ? null : b.value))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontSize: 13,
                  color: active ? "#fff" : "#aaa",
                  fontWeight: active ? 700 : 400,
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: BOROUGH_COLORS[b.value], display: "inline-block" }} />
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 24, maxWidth: 820 }}>
        <Scatter
          points={points}
          xLabel="Access Gap (minutes beyond expected travel time)"
          yLabel={`${demographicLabel} (%)`}
          fittedLine={fittedLine}
          showLine={showLine}
          selectedBorough={selectedBorough}
        />
      </div>
    </div>
  );
}
