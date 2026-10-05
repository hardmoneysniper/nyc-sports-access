"use client";

import { useEffect, useState } from "react";
import { withBasePath } from "@/lib/basePath";
import ScatterPlot, { type ScatterPoint } from "./ScatterPlot";
import PinnedScrollSequence from "./PinnedScrollSequence";
import CenteredDiagram from "./CenteredDiagram";

// Regression coefficients computed by export_burden_index() (soccer, as of
// 2026-09-29: log(density) r^2=0.41). Hardcoded here rather than exported
// as their own data file -- these are 2 fixed scalars for one fixed worked
// example (Elmhurst/soccer), not worth a new pipeline export.
const SLOPE = -3.801052455527018;
const INTERCEPT = 61.468314825924935;
const FORMULA_LABEL = "predicted = 61.47 − 3.80 × log(density)";

const ELMHURST_ID = "QN0401";
// Square, not the earlier wide 900x480 -- the wide version let long
// multi-line point labels run past the chart's own right edge and off
// the page. Reported live, 2026-10-05 ("text protruding"). The rendered
// size is driven by CenteredDiagram's CSS percentage width, not this
// value directly -- this only fixes the internal SVG coordinate system
// (and therefore the aspect ratio).
const CHART_SIZE = 520;
// Matches CHART_SIZE (never upscaled past its native viewBox size) -- the
// label now overflows the SVG's own right edge on purpose (ScatterPlot
// uses overflow:visible), so keeping the rendered diagram no bigger than
// its native size keeps that overflow modest in real screen pixels,
// comfortably inside the page's own margin around it.
const DIAGRAM_MAX_WIDTH = CHART_SIZE;

type NtaDatum = { id: string; name: string; density: number; population: number; travelTime: number };

function useRegressionData() {
  const [data, setData] = useState<NtaDatum[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(withBasePath("/data/demographics.geojson")).then((r) => r.json()),
      fetch(withBasePath("/data/travel_time.geojson")).then((r) => r.json()),
    ]).then(([demo, travel]: [GeoJSON.FeatureCollection, GeoJSON.FeatureCollection]) => {
      if (cancelled) return;
      const travelById = new Map<string, number>();
      for (const f of travel.features) {
        const id = f.properties?.NTA2020 as string;
        const t = f.properties?.travel_time_soccer as number | null | undefined;
        if (typeof t === "number") travelById.set(id, t);
      }
      const rows: NtaDatum[] = [];
      for (const f of demo.features) {
        const id = f.properties?.NTA2020 as string;
        const density = f.properties?.density as number | null | undefined;
        const population = f.properties?.total_population as number | null | undefined;
        const travelTime = travelById.get(id);
        if (typeof density === "number" && density > 0 && typeof population === "number" && typeof travelTime === "number") {
          rows.push({ id, name: (f.properties?.NTAName as string) ?? id, density, population, travelTime });
        }
      }
      setData(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #333", padding: "16px 20px", flex: 1, minWidth: 180 }}>
      <div style={{ fontSize: 13, color: "#999" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function NtaComparisonRow({
  name,
  population,
  density,
  travelTime,
}: {
  name: string;
  population: string;
  density: string;
  travelTime: string;
}) {
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{name}</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard label="Population" value={population} />
        <StatCard label="Density (per sq mi)" value={density} />
        <StatCard label="Soccer travel time" value={travelTime} />
      </div>
    </div>
  );
}

export default function BurdenScoreTab() {
  const data = useRegressionData();
  const [sceneIndex, setSceneIndex] = useState(0);

  const points: ScatterPoint[] = (data ?? []).map((d) => ({ id: d.id, x: Math.log(d.density), y: d.travelTime }));
  const elmhurst = (data ?? []).find((d) => d.id === ELMHURST_ID) ?? null;

  const xDomain: [number, number] = points.length
    ? [Math.min(...points.map((p) => p.x)) - 0.3, Math.max(...points.map((p) => p.x)) + 0.3]
    : [0, 1];
  const yDomain: [number, number] = points.length
    ? [0, Math.max(...points.map((p) => p.y)) + 3]
    : [0, 1];

  const predicted = elmhurst ? INTERCEPT + SLOPE * Math.log(elmhurst.density) : 0;
  const residual = elmhurst ? elmhurst.travelTime - predicted : 0;
  const burden = elmhurst ? Math.max(residual, 0) * (elmhurst.population / 10000) : 0;

  const elmhurstLabel = elmhurst
    ? [
        "Elmhurst",
        `Density: ${Math.round(elmhurst.density).toLocaleString()}/sqmi`,
        `Sports Access Time: ${elmhurst.travelTime.toFixed(1)} min`,
      ]
    : [];

  const commonChartProps = elmhurst
    ? {
        points,
        width: CHART_SIZE,
        height: CHART_SIZE,
        xDomain,
        yDomain,
        xLabel: "Population density (log scale)",
        yLabel: "Soccer travel time (min)",
      }
    : null;

  return (
    <div>
      <h1 style={{ fontSize: 48, fontWeight: 700, margin: 0 }}>Burden Score</h1>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>What this measure is for</h2>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc" }}>
          This measure finds New York City neighborhoods where getting to a sports facility takes longer than
          expected, and where that gap affects the most residents. The result is a ranked list of neighborhoods that
          can be flagged to policymakers.
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>Why not just divide travel time by population?</h2>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc" }}>
          Travel time already describes what a typical resident experiences, and it doesn&apos;t change depending on
          how many people live nearby. Dividing it by population would make large neighborhoods look better off
          simply because they&apos;re large, which would hide exactly the underserved places this measure is meant to
          find.
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>Density, not population</h2>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc" }}>
          Not every neighborhood should be expected to have the same travel time to a sports facility. Denser
          neighborhoods tend to sit closer to more transit and more destinations, so we use density, not population,
          to estimate how long a trip should take.
        </p>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc" }}>
          East Midtown-Turtle Bay and New Springville-Willowbrook-Bulls Head-Travis have almost the same population,
          about 42,000 residents each. But East Midtown is about 16 times denser. Population alone could not have
          predicted the difference in how long it takes their residents to reach a soccer field. Density does.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 20 }}>
          <NtaComparisonRow name="East Midtown-Turtle Bay" population="42,046" density="89,216" travelTime="16.2 min" />
          <NtaComparisonRow
            name="New Springville-Willowbrook-Bulls Head-Travis"
            population="42,601"
            density="5,672"
            travelTime="38.5 min"
          />
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>Building an expectation</h2>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc" }}>
          For every sport, we compare each neighborhood&apos;s travel time to its population density across the whole
          city. We take the logarithm of density because density varies enormously across the city, from a few
          hundred people per square mile to over 100,000, and the log scale keeps a handful of extremely dense
          neighborhoods from dominating the pattern. Fitting a line through this relationship gives an expected
          travel time for a neighborhood of any density. The scroll below walks through the process for one
          neighborhood, Elmhurst, using soccer as the example sport.
        </p>
      </section>

      {!data && <p style={{ color: "#777", marginTop: 40 }}>Loading data…</p>}

      {data && elmhurst && commonChartProps && (
        // marginTop here, not on the section above -- the scroll sequence's
        // sticky chart sits flush against whatever's immediately above it
        // the instant it mounts (it isn't "stuck" to top:15vh yet at that
        // point, since its natural flow position is already further down
        // the page), so with zero gap the chart's top edge visually
        // touched the last paragraph of "Building an expectation".
        // Reported live, 2026-10-05.
        <div style={{ marginTop: 64 }}>
        <PinnedScrollSequence
          activeIndex={sceneIndex}
          onActivate={setSceneIndex}
          stickyHeight={CHART_SIZE + 60}
          scenes={[
            <CenteredDiagram
              key="s0"
              maxWidth={DIAGRAM_MAX_WIDTH}
              caption="Every neighborhood's soccer travel time, plotted against its population density."
            >
              <ScatterPlot {...commonChartProps} />
            </CenteredDiagram>,

            <CenteredDiagram
              key="s1"
              maxWidth={DIAGRAM_MAX_WIDTH}
              caption="A fitted line gives the expected travel time at any density."
            >
              <ScatterPlot {...commonChartProps} fittedLine={{ slope: SLOPE, intercept: INTERCEPT }} formulaLabel={FORMULA_LABEL} />
            </CenteredDiagram>,

            <CenteredDiagram key="s2" maxWidth={DIAGRAM_MAX_WIDTH} caption="One neighborhood, Elmhurst, highlighted.">
              <ScatterPlot
                {...commonChartProps}
                fittedLine={{ slope: SLOPE, intercept: INTERCEPT }}
                formulaLabel={FORMULA_LABEL}
                highlightedId={ELMHURST_ID}
                highlightedLabel={elmhurstLabel}
              />
            </CenteredDiagram>,

            <CenteredDiagram
              key="s3"
              maxWidth={DIAGRAM_MAX_WIDTH}
              caption="Isolating Elmhurst's actual travel time."
            >
              <ScatterPlot
                {...commonChartProps}
                fittedLine={{ slope: SLOPE, intercept: INTERCEPT }}
                formulaLabel={FORMULA_LABEL}
                highlightedId={ELMHURST_ID}
                highlightedLabel={elmhurstLabel}
                isolateHighlighted
              />
            </CenteredDiagram>,

            <CenteredDiagram
              key="s4"
              maxWidth={DIAGRAM_MAX_WIDTH}
              caption="The hollow point is the expected travel time; the dashed line is the gap."
            >
              <ScatterPlot
                {...commonChartProps}
                fittedLine={{ slope: SLOPE, intercept: INTERCEPT }}
                formulaLabel={FORMULA_LABEL}
                highlightedId={ELMHURST_ID}
                highlightedLabel={elmhurstLabel}
                isolateHighlighted
                showResidualFor={ELMHURST_ID}
                expectedPointFor={ELMHURST_ID}
                expectedLabel={[`Expected: ${predicted.toFixed(1)} min`, `Gap: ${residual.toFixed(1)} min`]}
              />
            </CenteredDiagram>,

            <CenteredDiagram key="s5" widthPercent={80} maxWidth={560}>
              <div
                style={{
                  border: "1px solid #333",
                  padding: 24,
                  fontFamily: "monospace",
                  fontSize: 14,
                  lineHeight: 1.9,
                }}
              >
                <div>predicted = intercept + slope × log(density)</div>
                <div style={{ marginBottom: 12 }}>predicted = 61.47 + (−3.80) × log(density)</div>
                <div>density = {Math.round(elmhurst.density).toLocaleString()} people / sq mi</div>
                <div>log(density) = {Math.log(elmhurst.density).toFixed(2)}</div>
                <div style={{ marginTop: 12 }}>
                  predicted = 61.47 − 3.80 × {Math.log(elmhurst.density).toFixed(2)} = {predicted.toFixed(1)} min
                </div>
                <div>actual = {elmhurst.travelTime.toFixed(1)} min</div>
                <div>
                  residual = {elmhurst.travelTime.toFixed(1)} − {predicted.toFixed(1)} = {residual.toFixed(1)} min
                </div>
                <div style={{ marginTop: 12 }}>
                  burden = {residual.toFixed(1)} × ({elmhurst.population.toLocaleString()} ÷ 10,000) = {burden.toFixed(1)}
                </div>
              </div>
              <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc", marginTop: 16 }}>
                Every neighborhood, for every sport, is scored the same way.
              </p>
            </CenteredDiagram>,
          ]}
        />
        </div>
      )}
    </div>
  );
}
