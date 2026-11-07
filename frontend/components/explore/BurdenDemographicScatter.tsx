"use client";

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/basePath";
import { useSelection, DEMOGRAPHIC_CATEGORIES, SPORT_TYPES, type DemographicCategoryValue, type SportTypeValue } from "@/lib/selectionContext";

// Compare the map's population-weighted burden index with demographic percentages.
// Keep the existing positive-only neighborhood filter; the fitted line uses
// the same burden scores and neighborhoods as the plotted points.

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

type NtaPoint = { ntaCode: string; borough: BoroughCode | null; burdenIndex: number; demographicPct: number };

type RegressionEntry = { slope: number; intercept: number; r: number; n: number };
type Regressions = Record<string, Record<string, RegressionEntry>>;

function useScatterData(sportType: SportTypeValue, demographicCategory: DemographicCategoryValue) {
  const { accessMetric } = useSelection();
  const [points, setPoints] = useState<NtaPoint[] | null>(null);
  const [regressions, setRegressions] = useState<Regressions | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(withBasePath("/data/demographics.geojson")).then((r) => r.json()),
      fetch(withBasePath(`/data/${accessMetric}.geojson`)).then((r) => r.json()),
      fetch(withBasePath(`/data/${accessMetric}_demographic_regressions.json`)).then((r) => r.json()),
    ]).then(([demo, burdens, regr]: [GeoJSON.FeatureCollection, GeoJSON.FeatureCollection, Regressions]) => {
      if (cancelled) return;
      const burdenByNta = new Map<string, number>();
      for (const f of burdens.features) {
        const id = f.properties?.NTA2020 as string;
        const v = f.properties?.[`${accessMetric}_${sportType}`] as number | null | undefined;
        // Preserve the positive-only filter for underserved neighborhoods.
        if (typeof v === "number" && v > 0) burdenByNta.set(id, v);
      }
      const parsed: NtaPoint[] = [];
      for (const f of demo.features) {
        const ntaCode = f.properties?.NTA2020 as string;
        const burdenValue = burdenByNta.get(ntaCode);
        const demoValue = f.properties?.[demographicCategory] as number | null | undefined;
        if (typeof burdenValue === "number" && typeof demoValue === "number") {
          parsed.push({ ntaCode, borough: boroughOf(ntaCode), burdenIndex: burdenValue, demographicPct: demoValue });
        }
      }
      setPoints(parsed);
      setRegressions(regr);
    });
    return () => {
      cancelled = true;
    };
  }, [sportType, demographicCategory, accessMetric]);

  return { points, regressions };
}

// Round the metric axis to evenly spaced 1/2/5/10-based intervals.
function metricAxis(maxValue: number) {
  const paddedMax = Math.max(maxValue, 1) * 1.05;
  const roughStep = paddedMax / 6;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 5, 10].find((factor) => factor * magnitude >= roughStep)! * magnitude;
  const intervals = Math.ceil(paddedMax / step);
  return {
    domain: [0, intervals * step] as [number, number],
    ticks: Array.from({ length: intervals + 1 }, (_, i) => i * step),
    decimals: Math.max(0, -Math.floor(Math.log10(step))),
  };
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
  selectedNta,
  onSelectNta,
}: {
  points: NtaPoint[];
  xLabel: string;
  yLabel: string;
  fittedLine: RegressionEntry | null;
  showLine: boolean;
  selectedBorough: BoroughCode | null;
  selectedNta: string | null;
  onSelectNta: (id: string) => void;
}) {
  const width = 760;
  const height = 520;
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;

  const xDomain: [number, number] = [0, 100];
  const yAxis = useMemo(() => metricAxis(Math.max(...points.map((p) => p.burdenIndex), 1)), [points]);
  const yDomain = yAxis.domain;

  const sx = (x: number) => PAD_LEFT + ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotW;
  const sy = (y: number) => PAD_TOP + plotH - ((y - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotH;

  const xTicks = [0, 20, 40, 60, 80, 100];
  const yTicks = yAxis.ticks;
  const visiblePoints = selectedBorough === null ? points : points.filter((p) => p.borough === selectedBorough);
  const selectedPoint = visiblePoints.find((p) => p.ntaCode === selectedNta);
  const orderedPoints = selectedPoint ? [...visiblePoints.filter((p) => p !== selectedPoint), selectedPoint] : visiblePoints;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ display: "block", width: "100%", height: "auto", background: "#000" }}>
      <line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={PAD_TOP + plotH} stroke="#fff" strokeOpacity={0.4} />
      <line x1={PAD_LEFT} y1={PAD_TOP + plotH} x2={PAD_LEFT + plotW} y2={PAD_TOP + plotH} stroke="#fff" strokeOpacity={0.4} />
      {xTicks.filter((t) => !selectedPoint || Math.abs(sx(t) - sx(selectedPoint.demographicPct)) > 24).map((t) => (
        <text key={`xt-${t}`} x={sx(t)} y={PAD_TOP + plotH + 18} fill="#fff" fillOpacity={0.6} fontSize={11} textAnchor="middle">
          {t.toFixed(0)}
        </text>
      ))}
      {yTicks.filter((t) => !selectedPoint || Math.abs(sy(t) - sy(selectedPoint.burdenIndex)) > 14).map((t) => (
        <text key={`yt-${t}`} x={PAD_LEFT - 8} y={sy(t) + 4} fill="#fff" fillOpacity={0.6} fontSize={11} textAnchor="end">
          {t.toFixed(yAxis.decimals)}
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

      {selectedPoint && (
        <g pointerEvents="none">
          <path
            d={`M ${PAD_LEFT} ${sy(selectedPoint.burdenIndex)} H ${sx(selectedPoint.demographicPct)} V ${PAD_TOP + plotH}`}
            fill="none" stroke={selectedPoint.borough ? BOROUGH_COLORS[selectedPoint.borough] : "#ff5252"} strokeWidth={1.5} strokeDasharray="2 4"
          />
          <text x={sx(selectedPoint.demographicPct)} y={PAD_TOP + plotH + 18} fill={selectedPoint.borough ? BOROUGH_COLORS[selectedPoint.borough] : "#ff5252"} fontSize={11} fontWeight={600} textAnchor="middle">
            {selectedPoint.demographicPct.toFixed(1)}%
          </text>
          <text x={PAD_LEFT - 8} y={sy(selectedPoint.burdenIndex) + 4} fill={selectedPoint.borough ? BOROUGH_COLORS[selectedPoint.borough] : "#ff5252"} fontSize={11} fontWeight={600} textAnchor="end">
            {selectedPoint.burdenIndex.toFixed(1)}
          </text>
        </g>
      )}
      {orderedPoints.map((p) => {
        const isSelected = p.ntaCode === selectedNta;
        const isSelectedBorough = selectedBorough !== null && p.borough === selectedBorough;
        const isDimmed = selectedPoint ? !isSelected : selectedBorough !== null && !isSelectedBorough;
        const fill = isDimmed ? "#444" : (isSelected || isSelectedBorough) && p.borough ? BOROUGH_COLORS[p.borough] : "#fff";
        return (
          <g
            key={p.ntaCode}
            role={selectedBorough ? "button" : undefined} tabIndex={selectedBorough ? 0 : undefined}
            aria-label={`${p.ntaCode}: ${xLabel} ${p.demographicPct.toFixed(1)}%, ${yLabel} ${p.burdenIndex.toFixed(1)}`}
            aria-pressed={selectedBorough ? isSelected : undefined}
            onClick={selectedBorough ? () => onSelectNta(p.ntaCode) : undefined}
            onKeyDown={(event) => {
              if (selectedBorough && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onSelectNta(p.ntaCode);
              }
            }}
            className="scatter-point"
            style={{ cursor: selectedBorough ? "pointer" : "default" }}
          >
            <circle cx={sx(p.demographicPct)} cy={sy(p.burdenIndex)} r={8} fill="transparent" />
            <circle cx={sx(p.demographicPct)} cy={sy(p.burdenIndex)} r={isSelected ? 4 : 3} fill={fill} fillOpacity={isDimmed ? 0.7 : 1} />
          </g>
        );
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
  const { accessMetric } = useSelection();
  const metricLabel = accessMetric === "travel_time" ? "Average Travel Time" : "Access Burden Score";
  const { points, regressions } = useScatterData(sportType, demographicCategory);
  const [showLine, setShowLine] = useState(false);
  const [selectedNta, setSelectedNta] = useState<string | null>(null);
  const [selectedBorough, setSelectedBorough] = useState<BoroughCode | null>(null);

  const sportLabel = SPORT_TYPES.find((s) => s.value === sportType)?.label ?? sportType;
  const demographicLabel = DEMOGRAPHIC_CATEGORIES.find((c) => c.value === demographicCategory)?.label ?? demographicCategory;

  const fittedLine = regressions?.[sportType]?.[demographicCategory] ?? null;

  if (!points) {
    return (
      <div style={{ height: "100%", overflowY: "auto", padding: "72px 80px 120px", color: "#fff" }}>
        <p style={{ color: "#777", margin: 0 }}>Loading data…</p>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", scrollbarGutter: "stable", padding: "72px 80px 120px", color: "#fff" }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
        {metricLabel} vs. {demographicLabel} — {sportLabel}
      </h2>
      <p style={{ fontSize: 14, color: "#ccc", marginTop: 8 }}>
        {accessMetric === "travel_time" ? "Each point is one NTA’s population-weighted average travel time to the nearest facility, in minutes." : "Each point is one NTA with a positive access burden score (excess travel time weighted by population in units of 10,000 residents)."} {points.length} NTAs shown.
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
                onClick={() => { setSelectedNta(null); setSelectedBorough((prev) => (prev === b.value ? null : b.value)); }}
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
          key={`${sportType}-${demographicCategory}-${accessMetric}`}
          points={points}
          xLabel={`${demographicLabel} (%)`}
          yLabel={accessMetric === "travel_time" ? "Average Travel Time (minutes)" : metricLabel}
          fittedLine={fittedLine}
          showLine={showLine}
          selectedBorough={selectedBorough}
          selectedNta={selectedNta}
          onSelectNta={(id) => setSelectedNta((previous) => previous === id ? null : id)}
        />
      </div>
    </div>
  );
}
