"use client";

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/basePath";
import {
  useSelection,
  DEMOGRAPHIC_CATEGORIES,
  SPORT_TYPES,
  formatDemographicValue,
  type DemographicCategoryValue,
  type DemographicUnit,
  type SportTypeValue,
} from "@/lib/selectionContext";

// Compare the map's population-weighted burden index (or average travel
// time) with a demographic category. Keeps the existing positive-only
// neighborhood filter. An optional fitted line follows the borough filter.

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

type NtaPoint = { ntaCode: string; name: string; borough: BoroughCode | null; burdenIndex: number; demographicValue: number };

function fitTrendLine(points: NtaPoint[]) {
  const valid = points.filter((p) => Number.isFinite(p.demographicValue) && Number.isFinite(p.burdenIndex));
  if (valid.length < 2) return null;
  const meanX = valid.reduce((sum, p) => sum + p.demographicValue, 0) / valid.length;
  const meanY = valid.reduce((sum, p) => sum + p.burdenIndex, 0) / valid.length;
  const variance = valid.reduce((sum, p) => sum + (p.demographicValue - meanX) ** 2, 0);
  if (variance === 0) return null;
  const slope = valid.reduce((sum, p) => sum + (p.demographicValue - meanX) * (p.burdenIndex - meanY), 0) / variance;
  const minX = Math.min(...valid.map((p) => p.demographicValue));
  const maxX = Math.max(...valid.map((p) => p.demographicValue));
  return { minX, maxX, startY: meanY + slope * (minX - meanX), endY: meanY + slope * (maxX - meanX) };
}

function useScatterData(sportType: SportTypeValue, demographicCategory: DemographicCategoryValue) {
  const { accessMetric } = useSelection();
  const [points, setPoints] = useState<NtaPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(withBasePath("/data/demographics.geojson")).then((r) => r.json()),
      fetch(withBasePath(`/data/${accessMetric}.geojson`)).then((r) => r.json()),
    ]).then(([demo, burdens]: [GeoJSON.FeatureCollection, GeoJSON.FeatureCollection]) => {
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
          parsed.push({ ntaCode, name: (f.properties?.NTAName as string) ?? ntaCode, borough: boroughOf(ntaCode), burdenIndex: burdenValue, demographicValue: demoValue });
        }
      }
      setPoints(parsed);
    });
    return () => {
      cancelled = true;
    };
  }, [sportType, demographicCategory, accessMetric]);

  return points;
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

// Percentage categories keep the familiar fixed 0-100 axis (5 even bands);
// a currency category (median household income) has no natural fixed
// range, so it gets the same auto-rounded step axis as the y-axis.
function demographicAxis(points: NtaPoint[], unit: DemographicUnit) {
  if (unit === "percent") {
    return { domain: [0, 100] as [number, number], ticks: [0, 20, 40, 60, 80, 100], decimals: 1 };
  }
  return metricAxis(Math.max(...points.map((p) => p.demographicValue), 1));
}

function Scatter({
  points,
  xLabel,
  yLabel,
  unit,
  selectedBorough,
  showTrendLine,
  selectedNta,
  onSelectNta,
}: {
  points: NtaPoint[];
  xLabel: string;
  yLabel: string;
  unit: DemographicUnit;
  selectedBorough: BoroughCode | null;
  showTrendLine: boolean;
  selectedNta: string | null;
  onSelectNta: (id: string) => void;
}) {
  const width = 760;
  const height = 520;
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;

  const xAxis = useMemo(() => demographicAxis(points, unit), [points, unit]);
  const xDomain = xAxis.domain;
  const yAxis = useMemo(() => metricAxis(Math.max(...points.map((p) => p.burdenIndex), 1)), [points]);
  const yDomain = yAxis.domain;

  const sx = (x: number) => PAD_LEFT + ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotW;
  const sy = (y: number) => PAD_TOP + plotH - ((y - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotH;

  const xTicks = xAxis.ticks;
  const yTicks = yAxis.ticks;
  const visiblePoints = selectedBorough === null ? points : points.filter((p) => p.borough === selectedBorough);
  const trendLine = showTrendLine ? fitTrendLine(visiblePoints) : null;
  const selectedPoint = visiblePoints.find((p) => p.ntaCode === selectedNta);
  const orderedPoints = selectedPoint ? [...visiblePoints.filter((p) => p !== selectedPoint), selectedPoint] : visiblePoints;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMin meet" style={{ display: "block", width: "100%", height: "100%", background: "#000" }}>
      <line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={PAD_TOP + plotH} stroke="#fff" strokeOpacity={0.4} />
      <line x1={PAD_LEFT} y1={PAD_TOP + plotH} x2={PAD_LEFT + plotW} y2={PAD_TOP + plotH} stroke="#fff" strokeOpacity={0.4} />
      {xTicks.filter((t) => !selectedPoint || Math.abs(sx(t) - sx(selectedPoint.demographicValue)) > 24).map((t) => (
        <text key={`xt-${t}`} x={sx(t)} y={PAD_TOP + plotH + 18} fill="#fff" fillOpacity={0.6} fontSize={11} textAnchor="middle">
          {t.toFixed(xAxis.decimals)}
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

      {trendLine && (
        <svg x={PAD_LEFT} y={PAD_TOP} width={plotW} height={plotH} overflow="hidden" pointerEvents="none">
          <line
            x1={sx(trendLine.minX) - PAD_LEFT} y1={sy(trendLine.startY) - PAD_TOP}
            x2={sx(trendLine.maxX) - PAD_LEFT} y2={sy(trendLine.endY) - PAD_TOP}
            stroke={selectedBorough ? BOROUGH_COLORS[selectedBorough] : "#fff"}
            strokeWidth={2} strokeDasharray="6 4"
          >
            <title>Linear trend for {selectedBorough ? BOROUGHS.find((b) => b.value === selectedBorough)?.label : "all boroughs"}</title>
          </line>
        </svg>
      )}
      {selectedPoint && (
        <g pointerEvents="none">
          <path
            d={`M ${PAD_LEFT} ${sy(selectedPoint.burdenIndex)} H ${sx(selectedPoint.demographicValue)} V ${PAD_TOP + plotH}`}
            fill="none" stroke={selectedPoint.borough ? BOROUGH_COLORS[selectedPoint.borough] : "#ff5252"} strokeWidth={1.5} strokeDasharray="2 4"
          />
          <text x={sx(selectedPoint.demographicValue)} y={PAD_TOP + plotH + 18} fill={selectedPoint.borough ? BOROUGH_COLORS[selectedPoint.borough] : "#ff5252"} fontSize={11} fontWeight={600} textAnchor="middle">
            {formatDemographicValue(selectedPoint.demographicValue, unit)}
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
            aria-label={`${p.ntaCode}: ${xLabel} ${formatDemographicValue(p.demographicValue, unit)}, ${yLabel} ${p.burdenIndex.toFixed(1)}`}
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
            <circle cx={sx(p.demographicValue)} cy={sy(p.burdenIndex)} r={8} fill="transparent" />
            <circle cx={sx(p.demographicValue)} cy={sy(p.burdenIndex)} r={isSelected ? 3 : 2} fill={fill} fillOpacity={isDimmed ? 0.7 : 1} />
            {isSelected && (
              <text
                x={sx(p.demographicValue) + 8}
                y={sy(p.burdenIndex) - 8}
                fill={fill}
                fontSize={11}
                fontWeight={600}
                textAnchor="start"
                pointerEvents="none"
                stroke="#000"
                strokeWidth={3}
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {p.name}
              </text>
            )}
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
  const points = useScatterData(sportType, demographicCategory);
  const [selectedNta, setSelectedNta] = useState<string | null>(null);
  const [selectedBorough, setSelectedBorough] = useState<BoroughCode | null>(null);
  const [showTrendLine, setShowTrendLine] = useState(false);

  const sportLabel = SPORT_TYPES.find((s) => s.value === sportType)?.label ?? sportType;
  const demographicInfo = DEMOGRAPHIC_CATEGORIES.find((c) => c.value === demographicCategory);
  const demographicLabel = demographicInfo?.label ?? demographicCategory;
  const demographicUnit: DemographicUnit = demographicInfo?.unit ?? "percent";

  if (!points) {
    return (
      <div style={{ height: "100%", overflowY: "auto", padding: "72px 80px 120px", color: "#fff" }}>
        <p style={{ color: "#777", margin: 0 }}>Loading data…</p>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", padding: "64px clamp(24px, 4vw, 80px) 24px", color: "#fff" }}>
      <h2 style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.2, margin: 0 }}>
        {sportLabel}
      </h2>
      <p style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.4, marginTop: 8 }}>
        {metricLabel} vs. {demographicLabel}
      </p>
      <p style={{ fontSize: 14, color: "#ccc", marginTop: 8 }}>
        {accessMetric === "travel_time" ? "Each point is a NTA’s population-weighted average travel time to the nearest facility, in minutes." : "Each point is a NTA with a positive access burden score (excess travel time weighted by population in units of 10,000 residents)."} {selectedBorough === null ? points.length : points.filter((point) => point.borough === selectedBorough).length} NTAs shown.
      </p>


      <div style={{ display: "flex", gap: 24, marginTop: 16, flex: 1, minHeight: 0, width: "100%", overflow: "hidden" }}>
        <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
        <Scatter
          key={`${sportType}-${demographicCategory}-${accessMetric}`}
          points={points}
          xLabel={`${demographicLabel}${demographicUnit === "currency" ? " ($)" : " (%)"}`}
          yLabel={accessMetric === "travel_time" ? "Average Travel Time (minutes)" : metricLabel}
          unit={demographicUnit}
          selectedBorough={selectedBorough}
          showTrendLine={showTrendLine}
          selectedNta={selectedNta}
          onSelectNta={(id) => setSelectedNta((previous) => previous === id ? null : id)}
        />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 12, width: 160, flexShrink: 0, paddingTop: 24 }}>
        <button
          type="button"
          className="borough-select-button"
          aria-pressed={showTrendLine}
          onClick={() => setShowTrendLine((previous) => !previous)}
          style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, width: "100%", justifyContent: "space-between", flexShrink: 0, maxWidth: "100%", minHeight: 44, padding: "10px 14px", border: `1px solid ${showTrendLine ? "#fff" : "#444"}`, borderRadius: 0, background: showTrendLine ? "#222" : "transparent", color: "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.45 }}>Show trend line</span>
          <svg aria-hidden="true" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" style={{ flexShrink: 0, transform: showTrendLine ? "rotate(45deg)" : "rotate(0deg)", transition: "transform 220ms ease" }}>
            <path d="M5 12h14M12 5v14" />
          </svg>
        </button>
          {BOROUGHS.map((b) => {
            const active = selectedBorough === b.value;
            return (
              <button
                key={b.value}
                type="button"
                className="borough-select-button"
                aria-pressed={active}
                onClick={() => { setSelectedNta(null); setSelectedBorough((prev) => (prev === b.value ? null : b.value)); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minHeight: 36,
                  width: 148,
                  background: active ? `${BOROUGH_COLORS[b.value]}26` : "transparent",
                  border: `1px solid ${active ? BOROUGH_COLORS[b.value] : "#444"}`,
                  borderRadius: 0,
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: 12,
                  color: active ? "#fff" : "#aaa",
                  fontWeight: 600,
                }}
              >
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: BOROUGH_COLORS[b.value], display: "inline-block" }} />
                {b.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
