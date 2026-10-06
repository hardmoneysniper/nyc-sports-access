"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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
// Shared height for every scene in the scroll sequence -- only the first
// scene's own natural height actually sets this (the rest are
// position:absolute, sized to match it), so it has to be tall enough for
// the LARGEST scene's content (the multi-paragraph calculation walkthrough
// in the last scene), or that scene's text would overflow past the box
// the chart scenes defined.
const MIN_SCENE_HEIGHT = 1080;

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

// Generalized over a list of {label,value} stats -- reused for both the
// density-vs-population example and the gap-vs-population example below,
// same card format for both. Per project owner instruction, 2026-10-06.
function ComparisonRow({ name, stats }: { name: string; stats: { label: string; value: string }[] }) {
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{name}</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} />
        ))}
      </div>
    </div>
  );
}

// Vertically centers each scene's content within the shared scene-box
// height (see MIN_SCENE_HEIGHT) -- only the first scene actually sets that
// height (via minHeight), the rest just fill and center within whatever
// it ends up being.
function SceneFrame({ children, minHeight }: { children: ReactNode; minHeight?: number }) {
  return (
    <div style={{ minHeight, height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {children}
    </div>
  );
}

// Plain body font (not monospace) and a left border accent instead of a
// centered bordered box -- left-aligned with the rest of the page's
// content, not a separate floating card. Reported live, 2026-10-06.
function FormulaBlock({ children }: { children: ReactNode }) {
  return (
    <div style={{ borderLeft: "3px solid #444", paddingLeft: 16, margin: "20px 0", fontSize: 15, lineHeight: 1.9 }}>
      {children}
    </div>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc" }}>{children}</p>;
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
        <Prose>
          This measure finds New York City neighborhoods where getting to a sports facility takes longer than
          expected, and where that gap affects the most residents. The result is a ranked list of neighborhoods that
          can be flagged to policymakers.
        </Prose>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>Building an expectation</h2>
        <Prose>
          For every sport, we compare each neighborhood&apos;s travel time to its population density across the whole
          city. We take the logarithm of density because density varies enormously across the city, from a few
          hundred people per square mile to over 100,000, and the log scale keeps a handful of extremely dense
          neighborhoods from dominating the pattern. Fitting a line through this relationship gives an expected
          travel time to an NTA&apos;s nearest sports facility, for a neighborhood of any density. The scroll below
          walks through the process for one neighborhood, Elmhurst, using soccer as the example sport.
        </Prose>
      </section>

      {/* Right after "Building an expectation" and before the diagrams --
          explains why density, not population, is what sets the
          expectation the scroll below calculates. Per project owner
          instruction, 2026-10-06. */}
      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>Why Density/Travel Time</h2>
        <Prose>
          Our hypothesis is that denser neighborhoods do not necessarily have better sports access, not that more
          populous ones do. Population size on its own barely differs between the two NTAs below, so it cannot
          explain why one has far worse access than the other. Density can, which is why density, not population,
          sets the expectation this measure compares each neighborhood against.
        </Prose>
        <Prose>
          A regression that predicts travel time from population alone gives East Midtown and New Springville almost
          the same expected time, about 21.5 min each, since their populations are nearly equal. Their actual times
          are 16.2 and 38.5 min: population explains almost none of that gap. Swapping in density instead predicts
          18.1 min and 28.6 min, correctly showing the denser neighborhood with the shorter expected trip, far closer
          to what actually happens.
        </Prose>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 20 }}>
          <ComparisonRow
            name="East Midtown-Turtle Bay — Population: 42,046, Density: 89,216/sq mi"
            stats={[
              { label: "Predicted (population model)", value: "21.5 min" },
              { label: "Predicted (density model)", value: "18.1 min" },
              { label: "Actual soccer travel time", value: "16.2 min" },
            ]}
          />
          <ComparisonRow
            name="New Springville-Willowbrook-Bulls Head-Travis — Population: 42,601, Density: 5,672/sq mi"
            stats={[
              { label: "Predicted (population model)", value: "21.4 min" },
              { label: "Predicted (density model)", value: "28.6 min" },
              { label: "Actual soccer travel time", value: "38.5 min" },
            ]}
          />
        </div>
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
          topOffset={64}
          scenes={[
            <SceneFrame key="s0" minHeight={MIN_SCENE_HEIGHT}>
              <CenteredDiagram
                maxWidth={DIAGRAM_MAX_WIDTH}
                caption="Every neighborhood's soccer travel time, plotted against its population density."
              >
                <ScatterPlot {...commonChartProps} />
              </CenteredDiagram>
            </SceneFrame>,

            <SceneFrame key="s1">
              <CenteredDiagram
                maxWidth={DIAGRAM_MAX_WIDTH}
                caption="A fitted line gives the expected travel time at any density."
              >
                <ScatterPlot {...commonChartProps} fittedLine={{ slope: SLOPE, intercept: INTERCEPT }} formulaLabel={FORMULA_LABEL} />
              </CenteredDiagram>
            </SceneFrame>,

            <SceneFrame key="s2">
              <CenteredDiagram maxWidth={DIAGRAM_MAX_WIDTH} caption="One neighborhood, Elmhurst, highlighted.">
                <ScatterPlot
                  {...commonChartProps}
                  fittedLine={{ slope: SLOPE, intercept: INTERCEPT }}
                  formulaLabel={FORMULA_LABEL}
                  highlightedId={ELMHURST_ID}
                  highlightedLabel={elmhurstLabel}
                />
              </CenteredDiagram>
            </SceneFrame>,

            <SceneFrame key="s3">
              <CenteredDiagram maxWidth={DIAGRAM_MAX_WIDTH} caption="Isolating Elmhurst's actual travel time.">
                <ScatterPlot
                  {...commonChartProps}
                  fittedLine={{ slope: SLOPE, intercept: INTERCEPT }}
                  formulaLabel={FORMULA_LABEL}
                  highlightedId={ELMHURST_ID}
                  highlightedLabel={elmhurstLabel}
                  isolateHighlighted
                />
              </CenteredDiagram>
            </SceneFrame>,

            <SceneFrame key="s4">
              <CenteredDiagram
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
              </CenteredDiagram>
            </SceneFrame>,

            // Broken into parts -- symbolic formula, then Elmhurst's
            // numbers substituted in, then the gap against the actual
            // travel time, then the population weighting -- with a short
            // explanation after each, instead of one long code block.
            // Plain body font and a left border accent (not a centered
            // bordered box), matching the rest of the page's content.
            // Reported live, 2026-10-06.
            <SceneFrame key="s5">
              <div style={{ width: "100%" }}>
                <FormulaBlock>predicted = intercept + slope × log(density)</FormulaBlock>
                <Prose>
                  This is the line fitted across every neighborhood in the city: it turns a neighborhood&apos;s
                  density into an expected travel time. Plugging in Elmhurst&apos;s own numbers:
                </Prose>
                <FormulaBlock>
                  <div>density = {Math.round(elmhurst.density).toLocaleString()} people / sq mi</div>
                  <div>log(density) = {Math.log(elmhurst.density).toFixed(2)}</div>
                  <div style={{ marginTop: 12 }}>
                    predicted = 61.47 − 3.80 × {Math.log(elmhurst.density).toFixed(2)} = {predicted.toFixed(1)} min
                  </div>
                </FormulaBlock>
                <Prose>
                  Elmhurst&apos;s actual soccer travel time is {elmhurst.travelTime.toFixed(1)} min, {residual.toFixed(1)}{" "}
                  min longer than the {predicted.toFixed(1)} min a neighborhood this dense is expected to have.
                </Prose>
                <FormulaBlock>
                  <div>actual = {elmhurst.travelTime.toFixed(1)} min</div>
                  <div>
                    residual = {elmhurst.travelTime.toFixed(1)} − {predicted.toFixed(1)} = {residual.toFixed(1)} min
                  </div>
                </FormulaBlock>
                <Prose>
                  To turn that gap into a burden score, we multiply it by Elmhurst&apos;s population (divided by
                  10,000 just to keep the final numbers readable). The reason for that is: for NTAs with larger
                  populations, a shortfall in sports access has a bigger effect as more people are affected by 
                  the lack of sports facilities.
                </Prose>
                <Prose><br></br>
                  Tompkinsville-Stapleton-Clifton-Fox Hills and Elmhurst have almost the same gap, about 8.4 and 8.8
                  minutes. But Elmhurst has more than 5 times the population, so its burden score ends up nearly 6
                  times higher.
                </Prose>
                <div style={{ display: "flex", flexDirection: "column", gap: 20, margin: "20px 0" }}>
                  <ComparisonRow
                    name="Tompkinsville-Stapleton-Clifton-Fox Hills"
                    stats={[
                      { label: "Population", value: "18,170" },
                      { label: "Gap (actual − expected)", value: "8.4 min" },
                      { label: "Burden score", value: "15.3" },
                    ]}
                  />
                  <ComparisonRow
                    name="Elmhurst"
                    stats={[
                      { label: "Population", value: "100,015" },
                      { label: "Gap (actual − expected)", value: "8.8 min" },
                      { label: "Burden score", value: "88.0" },
                    ]}
                  />
                </div>
                <FormulaBlock>
                  burden = {residual.toFixed(1)} × ({elmhurst.population.toLocaleString()} ÷ 10,000) = {burden.toFixed(1)}
                </FormulaBlock>
                <Prose>Every neighborhood, for every sport, is scored the same way.</Prose>
              </div>
            </SceneFrame>,
          ]}
        />
        </div>
      )}
    </div>
  );
}
