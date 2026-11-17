"use client";

import { useEffect, useState } from "react";
import { withBasePath } from "@/lib/basePath";

type Metric = { label: string; value: string; rank: number | null; total: number; tied: boolean };

function rankedMetric(data: GeoJSON.FeatureCollection, ntaCode: string, property: string, label: string, unit: string, decimals: number): Metric {
  const valid = data.features.filter((feature) => typeof feature.properties?.[property] === "number" && Number.isFinite(feature.properties[property]) && (!property.startsWith("burden_index_") || feature.properties[property] > 0));
  const value = data.features.find((feature) => feature.properties?.NTA2020 === ntaCode)?.properties?.[property] as number | undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return { label, value: "No data", rank: null, total: valid.length, tied: false };
  return {
    label,
    value: `${value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${unit}`,
    rank: property.startsWith("burden_index_") && value <= 0 ? null : 1 + valid.filter((feature) => feature.properties![property] > value).length,
    total: valid.length,
    tied: valid.filter((feature) => feature.properties![property] === value).length > 1,
  };
}

export default function NtaInfoPanel({ ntaCode, sport }: { ntaCode: string; sport: string | null }) {
  const [info, setInfo] = useState<{ name: string; metrics: Metric[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(["burden_index", "travel_time", "demographics"].map(async (file) => {
      const response = await fetch(withBasePath(`/data/${file}.geojson`), { signal: controller.signal });
      if (!response.ok) throw new Error("Unable to load neighborhood statistics");
      return response.json() as Promise<GeoJSON.FeatureCollection>;
    })).then(([burden, travel, demographics]) => {
      if (controller.signal.aborted) return;
      const name = demographics.features.find((feature) => feature.properties?.NTA2020 === ntaCode)?.properties?.NTAName ?? ntaCode;
      setInfo({ name, metrics: [
        ...(sport ? [
          rankedMetric(burden, ntaCode, `burden_index_${sport}`, "Access Burden Score", "", 1),
          rankedMetric(travel, ntaCode, `travel_time_${sport}`, "Average travel time", " min", 1),
        ] : []),
        rankedMetric(demographics, ntaCode, "density", "Population density", "/mi²", 0),
      ] });
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [ntaCode, sport]);

  return <section aria-label="Neighborhood statistics" style={{ width: "100%", padding: 0, background: "#000", color: "#fff" }}>
    {!info ? <p style={{ fontSize: 13 }}>{failed ? "Neighborhood statistics could not be loaded." : "Loading neighborhood statistics…"}</p> : <>
      <dl style={{ margin: 0 }}>
        {info.metrics.map((metric, index) => <div key={metric.label} style={{ borderTop: index === 0 ? "none" : "1px solid #333", paddingTop: index === 0 ? 0 : 12, marginTop: index === 0 ? 0 : 12 }}>
          <dt style={metric.label === "Access Burden Score" ? { position: "absolute", width: 1, height: 1, padding: 0, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" } : { color: "#bbb", fontSize: 12 }}>{metric.label}</dt>
          <dd style={{ margin: "5px 0 0", fontSize: 15, fontWeight: 600 }}>{metric.value}</dd>
          {metric.label === "Access Burden Score" && metric.rank !== null && <dd style={{ margin: "4px 0 0", fontSize: 11, color: "#aaa" }}>Citywide rank: {metric.tied ? "Tied " : ""}{metric.rank} of {metric.total}</dd>}
          {metric.label === "Access Burden Score" && <dd style={{ display: "flex", alignItems: "flex-start", gap: 5, margin: "10px 0 0", fontSize: 11, lineHeight: 1.4, color: "#888" }}><span style={{ flexShrink: 0 }}>*</span><span>Rank 1 = highest burden score. Only NTAs with positive score are ranked; equal scores share the same rank.</span></dd>}
        </div>)}
      </dl>
    </>}
  </section>;
}
