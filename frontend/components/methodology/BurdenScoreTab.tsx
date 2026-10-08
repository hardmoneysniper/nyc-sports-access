"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { withBasePath } from "@/lib/basePath";
import ScatterPlot, { type ScatterPoint } from "./ScatterPlot";
import SplitPanel from "./SplitPanel";
import Fraction from "./Fraction";
import { useAutoLoop } from "./useAutoLoop";

const REGRESSION_SCENE_COUNT = 5;

// Regression coefficients computed by export_burden_index() (soccer, as of
// 2026-09-29: log(density) r^2=0.41). Hardcoded here rather than exported
// as their own data file -- these are 2 fixed scalars for one fixed worked
// example (Elmhurst/soccer), not worth a new pipeline export.
const SLOPE = -3.801052455527018;
const INTERCEPT = 61.468314825924935;

const ELMHURST_ID = "QN0401";
// Internal SVG coordinate system only -- the rendered size is controlled
// by SplitPanel's bordered box (CSS), not this value directly.
const CHART_SIZE = 400;
// Caps the box's own width so it hugs the chart (plus room for the
// Elmhurst label to spill right of it) instead of stretching to the full
// half-column width and leaving dead space below a smaller diagram. Widened
// a little further so its right edge lines up with the full-width intro
// paragraph above this section. Reported live, 2026-10-08 ("align to the
// text above").
const BOX_MAX_WIDTH = CHART_SIZE + 170;
// Height the box resolves to at BOX_MAX_WIDTH (via the aspectRatio string
// below) -- just the chart plus a comfortable bottom margin, instead of
// the 1:1 ratio's old height equal to the (now wider) box width. Reported
// live, 2026-10-08 ("reduce the height... to fit the animation with a
// comfortable padding").
const BOX_HEIGHT = CHART_SIZE + 48;

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

function Prose({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <p style={{ fontSize: 18, lineHeight: 1.65, color: "#ccc", marginTop: 12, ...style }}>{children}</p>;
}

export default function BurdenScoreTab() {
  const data = useRegressionData();
  const activeIndex = useAutoLoop(REGRESSION_SCENE_COUNT, 2000);

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

  // Caps each scene's rendered chart at its own native square size rather
  // than letting it stretch to fill the (now wider-than-square) box.
  // marginRight:"auto" (not SplitPanel's default centering) anchors the
  // chart to the box's LEFT edge, so every pixel of extra box width goes
  // to the label's side instead of being split evenly on both sides --
  // centering wasted half of any width increase on a left gap the label
  // never used. Reported live, 2026-10-08 ("still protruding... increase
  // the width of the containing box to the left").
  function chartScene(node: ReactNode) {
    return <div style={{ width: CHART_SIZE, maxWidth: "100%", marginLeft: 30, marginTop: 15 ,marginRight: "auto" }}>{node}</div>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 48, fontWeight: 700, margin: 0 }}>Burden Score</h1>

      <Prose>
        Our score identifies neighborhoods where residents face longer trips to public sports facilities than
        expected for their population density, especially when those gaps affect many people. We calculate the score
        separately for each sport and travel mode.
      </Prose>

      {!data && <p style={{ color: "#777", marginTop: 40 }}>Loading data…</p>}

      {data && elmhurst && commonChartProps && (
        <section style={{ marginTop: 56 }}>
          <h2 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Estimating expected travel time</h2>
          <div style={{ marginTop: 32 }}>
          <SplitPanel
            activeIndex={activeIndex}
            aspectRatio={`${BOX_MAX_WIDTH} / ${BOX_HEIGHT}`}
            boxMaxWidth={BOX_MAX_WIDTH}
            sceneBottomPadding={32}
            scenes={[
              chartScene(<ScatterPlot key="s0" {...commonChartProps} />),
              chartScene(
                <ScatterPlot key="s1" {...commonChartProps} fittedLine={{ slope: SLOPE, intercept: INTERCEPT }} />
              ),
              chartScene(
                <ScatterPlot
                  key="s2"
                  {...commonChartProps}
                  fittedLine={{ slope: SLOPE, intercept: INTERCEPT }}
                  highlightedId={ELMHURST_ID}
                  highlightedLabel={elmhurstLabel}
                />
              ),
              chartScene(
                <ScatterPlot
                  key="s3"
                  {...commonChartProps}
                  fittedLine={{ slope: SLOPE, intercept: INTERCEPT }}
                  highlightedId={ELMHURST_ID}
                  highlightedLabel={elmhurstLabel}
                  isolateHighlighted
                />
              ),
              chartScene(
                <ScatterPlot
                  key="s4"
                  {...commonChartProps}
                  fittedLine={{ slope: SLOPE, intercept: INTERCEPT }}
                  highlightedId={ELMHURST_ID}
                  highlightedLabel={elmhurstLabel}
                  isolateHighlighted
                  showResidualFor={ELMHURST_ID}
                  expectedPointFor={ELMHURST_ID}
                  expectedLabel={[`Expected: ${predicted.toFixed(1)} min`, `Gap: ${residual.toFixed(1)} min`]}
                />
              ),
            ]}
            captions={[
              "Every neighborhood's soccer travel time, plotted against its population density.",
              "A fitted line gives the expected travel time at any density.",
              "One neighborhood, Elmhurst, highlighted.",
              "Isolating Elmhurst's actual travel time.",
              "The hollow point is the expected travel time; the dashed line is the gap.",
            ]}
          >
            <Prose style={{ marginTop: 0 }}>
              Population density describes how closely residents live together. We use it as a predictor of average
              travel time to the nearest public sports facility.
            </Prose>
            <Prose>
              For each sport, we plot NYC neighborhoods&apos; average travel times against the logarithm of their
              population densities. Taking the logarithm compresses density&apos;s wide range. Each dot in the chart
              represents a neighborhood.
            </Prose>
            <Prose>
              We use linear regression to calculate the white line, minimizing the sum of squared vertical distances
              between the dots and the line. This results in an equation that estimates expected travel time from
              population density, based on the citywide pattern.
            </Prose>
            <div style={{ fontSize: 20, color: "#fff", margin: "24px 0" }}>
              Expected Travel Time = 61.47 − 3.80 × ln(density)
            </div>
            <Prose>
              Take Elmhurst, for example. With a population density of {Math.round(elmhurst.density).toLocaleString()}{" "}
              people per square mile, its expected travel time to the nearest public soccer field is{" "}
              {predicted.toFixed(1)} minutes.
            </Prose>
          </SplitPanel>
          </div>
        </section>
      )}

      <section style={{ marginTop: 56 }}>
        <h2 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Calculating the Access Burden Score</h2>
        <Prose>
          To calculate the Access Burden Score, we first find the gap between a neighborhood&apos;s actual average
          travel time and the expected travel time for its population density. We multiply any positive gap by the
          neighborhood&apos;s population measured in tens of thousands to keep the scores manageable. This gives
          greater weight to gaps affecting neighborhoods with a larger population. If actual travel time is at or
          below the expected time, the score is zero.
        </Prose>
        <div
          style={{
            fontSize: 22,
            color: "#fff",
            textAlign: "center",
            margin: "40px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: 4,
          }}
        >
          <span>Access Burden Score = ( Actual Travel Time − Expected Travel Time ) ×</span>
          <Fraction numerator="Population" denominator="10,000" />
        </div>
      </section>

      <section style={{ marginTop: 56 }}>
        <h2 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Why use density as the predictor?</h2>
        <Prose>
          Our mission is to identify neighborhoods where trips to public sports facilities are longer than expected
          for how closely residents live together. Density describes this concentration, while population only
          tells us how many people live there.
        </Prose>
        <Prose>
          For example, if two neighborhoods have the same population and actual travel time, a population-based
          model gives them the same burden score. Using density gives the denser neighborhood a shorter expected
          travel time. If their actual time exceeds that expectation, the denser neighborhood has a larger gap and a
          higher burden score. Which better reflects how far access falls short in a neighborhood where residents
          live closer together and would be expected to have shorter trips.
        </Prose>
      </section>
    </div>
  );
}
