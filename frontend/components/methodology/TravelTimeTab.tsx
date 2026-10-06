"use client";

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/basePath";
import PinnedScrollSequence from "./PinnedScrollSequence";
import CenteredDiagram from "./CenteredDiagram";
import { boundsOf, exteriorRingOf, makeCenteredProjector, polygonCentroid, type LngLat } from "./geoProjection";

// Illustrative worked example -- same neighborhood as the Burden Score
// tab, for continuity. The per-route minutes shown here come from the
// evening-window route detail (the only window with full segment-by-
// segment geometry saved).
const ELMHURST_ID = "QN0401";
// The real weekday-frequency-weighted figure from travel_time.geojson
// (same value export_burden_index() and the Burden Score tab use) --
// hardcoded rather than fetched: the full citywide file is 5.4MB just to
// read this one NTA's one number. Per project owner instruction,
// 2026-10-06 ("the travel time maps are loaded pretty slowly").
const NTA_AVERAGE_MINUTES = 28.0758283409571;
// One fixed size for every map scene (tract-only / +facility / +routes) --
// a size or viewBox that differed scene-to-scene made the map appear to
// jump/zoom as the user scrolled between them. Reported live, 2026-10-05.
const MAP_W = 760;
const MAP_H = 560;
// CenteredDiagram's width is a CSS percentage of the available content
// pane, so this can't overflow regardless of value -- bigger just means a
// smaller margin around it. Per project owner instruction, 2026-10-05
// ("bigger but not overflowing").
const MAP_WIDTH_PERCENT = 92;
const MAP_MAX_WIDTH = 1100;

type TractDatum = { geoid: string; ring: LngLat[]; centroid: LngLat };
type RouteSegment = { mode: string; coords: LngLat[] };
type RouteDatum = { geoid: string; facilityId: string; totalMinutes: number; segments: RouteSegment[] };

function useTravelTimeData() {
  const [tracts, setTracts] = useState<TractDatum[] | null>(null);
  const [routes, setRoutes] = useState<RouteDatum[] | null>(null);
  // Real OSM street geometry around Elmhurst (see
  // scripts/extract_elmhurst_roads.py) -- a decorative backdrop, but one
  // that actually reflects the neighborhood's real road network, not a
  // synthetic grid. Per project owner instruction, 2026-10-05.
  const [roads, setRoads] = useState<LngLat[][] | null>(null);
  const [facilityPoints, setFacilityPoints] = useState<Map<string, LngLat> | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(withBasePath(`/data/tracts/${ELMHURST_ID}.geojson`))
      .then((r) => r.json())
      .then((d: GeoJSON.FeatureCollection) => {
        if (cancelled) return;
        const parsed: TractDatum[] = d.features.map((f) => {
          const ring = exteriorRingOf(f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon);
          return { geoid: f.properties?.GEOID as string, ring, centroid: polygonCentroid(ring) };
        });
        setTracts(parsed);
      });

    // Pre-filtered to soccer/weekday_evening by
    // scripts/extract_elmhurst_soccer_routes.py (85KB, 62 features) --
    // the full routes/QN0401.geojson is 6.1MB covering every sport and
    // both time windows, and this tab only ever needed this one slice of
    // it. Per project owner instruction, 2026-10-06.
    fetch(withBasePath("/data/routes/QN0401_soccer_weekday_evening.geojson"))
      .then((r) => r.json())
      .then((d: GeoJSON.FeatureCollection) => {
        if (cancelled) return;

        const byKey = new Map<string, GeoJSON.Feature[]>();
        for (const f of d.features) {
          const key = `${f.properties?.GEOID}__${f.properties?.option}`;
          if (!byKey.has(key)) byKey.set(key, []);
          byKey.get(key)!.push(f);
        }
        const bestByTract = new Map<string, { total: number; segs: GeoJSON.Feature[] }>();
        for (const segs of byKey.values()) {
          const geoid = segs[0].properties?.GEOID as string;
          const total = segs.reduce(
            (sum, s) => sum + ((s.properties?.travel_time as number) || 0) + ((s.properties?.wait_time as number) || 0),
            0
          );
          const existing = bestByTract.get(geoid);
          if (!existing || total < existing.total) bestByTract.set(geoid, { total, segs });
        }
        const parsed: RouteDatum[] = Array.from(bestByTract.entries()).map(([geoid, v]) => ({
          geoid,
          facilityId: v.segs[0].properties?.nearest_facility_id as string,
          totalMinutes: v.total / 60,
          segments: [...v.segs]
            .sort((a, b) => (a.properties?.segment as number) - (b.properties?.segment as number))
            .map((s) => ({
              mode: (s.properties?.transport_mode as string) ?? "",
              coords: (s.geometry as GeoJSON.LineString).coordinates as LngLat[],
            })),
        }));
        setRoutes(parsed);
      });

    fetch(withBasePath("/data/roads/QN0401.geojson"))
      .then((r) => r.json())
      .then((d: GeoJSON.FeatureCollection) => {
        if (cancelled) return;
        setRoads(d.features.map((f) => (f.geometry as GeoJSON.LineString).coordinates as LngLat[]));
      });

    fetch(withBasePath("/data/facilities/soccer.geojson"))
      .then((r) => r.json())
      .then((d: GeoJSON.FeatureCollection) => {
        if (cancelled) return;
        const map = new Map<string, LngLat>();
        for (const f of d.features) {
          const id = f.properties?.facility_id as string;
          const ring = exteriorRingOf(f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon);
          map.set(id, polygonCentroid(ring));
        }
        setFacilityPoints(map);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { tracts, routes, roads, facilityPoints };
}

// Real street geometry (scripts/extract_elmhurst_roads.py), projected with
// the same projector as the tracts/facilities -- so it lines up with them
// geographically instead of being an abstract pattern. Extracted for a
// bbox padded well beyond the NTA itself, so it reads as a city continuing
// past the edges of the illustrated area; anything outside the viewBox is
// simply clipped by the SVG's own bounds. Very dark grey, very wide
// strokes -- "almost invisible" against the pure black background by
// color, not by opacity (opacity alone made it too easy to miss). Per
// project owner instruction, 2026-10-05.
function RoadNetworkLayer({ roads, project }: { roads: LngLat[][]; project: (p: LngLat) => [number, number] }) {
  return (
    <g aria-hidden>
      {roads.map((line, i) => (
        <polyline
          key={i}
          points={line.map((c) => project(c).join(",")).join(" ")}
          fill="none"
          stroke="#232323"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}

export default function TravelTimeTab() {
  const { tracts, routes, roads, facilityPoints } = useTravelTimeData();
  const [sceneIndex, setSceneIndex] = useState(0);

  const facilityCoords = useMemo(() => {
    if (!routes || !facilityPoints) return [];
    const ids = Array.from(new Set(routes.map((r) => r.facilityId)));
    return ids.map((id) => facilityPoints.get(id)).filter((p): p is LngLat => !!p);
  }, [routes, facilityPoints]);

  // The NTA's own tracts stay centered on the canvas regardless of where a
  // nearest facility happens to fall; the scale is still sized to fit the
  // facility markers too, so nothing relevant gets clipped. Per project
  // owner instruction, 2026-10-05 ("center the NTA itself on the map").
  const bounds = useMemo(() => {
    if (!tracts || facilityCoords.length === 0) return null;
    return {
      centerBounds: boundsOf(tracts.flatMap((t) => t.ring)),
      extentBounds: boundsOf([...tracts.flatMap((t) => t.ring), ...facilityCoords]),
    };
  }, [tracts, facilityCoords]);

  const project = useMemo(
    () => (bounds ? makeCenteredProjector(bounds.centerBounds, bounds.extentBounds, MAP_W, MAP_H, 30) : null),
    [bounds]
  );

  const ready = tracts && routes && roads && project;
  const routesActive = sceneIndex === 2;

  // Shared between the interactive route-reveal scene and the final
  // scene's faded backdrop (the "completed route visualization from the
  // previous scroll" behind the average-minutes number), so the two don't
  // drift out of sync with each other. Per project owner instruction,
  // 2026-10-05.
  function renderRouteMapSvg({ showRoutes, stagger }: { showRoutes: boolean; stagger: boolean }) {
    return (
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <RoadNetworkLayer roads={roads!} project={project!} />
        {tracts!.map((t) => (
          <polygon
            key={t.geoid}
            points={t.ring.map((p) => project!(p).join(",")).join(" ")}
            fill="none"
            stroke="#fff"
            strokeOpacity={0.25}
            strokeWidth={1}
          />
        ))}
        {routes!.map((r, i) => (
          <g
            key={r.geoid}
            style={{
              opacity: showRoutes ? 1 : 0,
              transition: stagger ? `opacity 400ms ease ${i * 45}ms` : undefined,
            }}
          >
            {r.segments.map((seg, si) => (
              <polyline
                key={si}
                points={seg.coords.map((c) => project!(c).join(",")).join(" ")}
                fill="none"
                stroke="#fff"
                strokeWidth={1.5}
                strokeOpacity={0.85}
              />
            ))}
          </g>
        ))}
        {facilityCoords.map((p, i) => {
          const [x, y] = project!(p);
          return <rect key={i} x={x - 5} y={y - 5} width={10} height={10} fill="#fff" />;
        })}
      </svg>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 48, fontWeight: 700, margin: 0 }}>Travel Time</h1>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>Why census tracts</h2>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc" }}>
          Neighborhoods are too large to route from a single point, since residents on opposite ends of the same
          neighborhood can have very different trips. We route from each census tract inside a neighborhood instead,
          then combine the tracts back into a neighborhood-level number. The scroll below walks through the process
          for one neighborhood, Elmhurst, using soccer as the example sport.
        </p>
      </section>

      {!ready && <p style={{ color: "#777", marginTop: 40 }}>Loading data…</p>}

      {ready && (
        <div style={{ marginTop: 24 }}>
        <PinnedScrollSequence
          activeIndex={sceneIndex}
          onActivate={setSceneIndex}
          topOffset={64}
          scenes={[
            <CenteredDiagram
              key="s0"
              widthPercent={MAP_WIDTH_PERCENT}
              maxWidth={MAP_MAX_WIDTH}
              caption={`Elmhurst's ${tracts!.length} census tracts, each with its own center point.`}
            >
              <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width: "100%", height: "auto", display: "block" }}>
                <RoadNetworkLayer roads={roads!} project={project!} />
                {tracts!.map((t) => (
                  <polygon
                    key={t.geoid}
                    points={t.ring.map((p) => project!(p).join(",")).join(" ")}
                    fill="none"
                    stroke="#fff"
                    strokeOpacity={0.45}
                    strokeWidth={1}
                  />
                ))}
                {tracts!.map((t) => {
                  const [x, y] = project!(t.centroid);
                  return <circle key={t.geoid} cx={x} cy={y} r={3} fill="#fff" />;
                })}
              </svg>
            </CenteredDiagram>,

            <CenteredDiagram
              key="s1"
              widthPercent={MAP_WIDTH_PERCENT}
              maxWidth={MAP_MAX_WIDTH}
              caption="Each tract's nearest soccer facility (squares) is found separately."
            >
              <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width: "100%", height: "auto", display: "block" }}>
                <RoadNetworkLayer roads={roads!} project={project!} />
                {tracts!.map((t) => (
                  <polygon
                    key={t.geoid}
                    points={t.ring.map((p) => project!(p).join(",")).join(" ")}
                    fill="none"
                    stroke="#fff"
                    strokeOpacity={0.3}
                    strokeWidth={1}
                  />
                ))}
                {tracts!.map((t) => {
                  const [x, y] = project!(t.centroid);
                  return <circle key={t.geoid} cx={x} cy={y} r={3} fill="#fff" fillOpacity={0.6} />;
                })}
                {facilityCoords.map((p, i) => {
                  const [x, y] = project!(p);
                  return <rect key={i} x={x - 5} y={y - 5} width={10} height={10} fill="#fff" />;
                })}
              </svg>
            </CenteredDiagram>,

            <CenteredDiagram
              key="s2"
              widthPercent={MAP_WIDTH_PERCENT}
              maxWidth={MAP_MAX_WIDTH}
              caption="Calculate every tract's travel route and time to its nearest facility, by transit."
            >
              {renderRouteMapSvg({ showRoutes: routesActive, stagger: true })}
            </CenteredDiagram>,

            // Same CenteredDiagram props and the same completed map as
            // scene s2 -- not a separately laid-out redraw -- so the map
            // doesn't visually shift or rescale under the crossfade. A 50%
            // black layer settles over it and the average fades in on top,
            // reading as "the just-finished route map, dimmed." Reported
            // live, 2026-10-05 ("the faded backdrop is not aligned").
            <CenteredDiagram key="s3" widthPercent={MAP_WIDTH_PERCENT} maxWidth={MAP_MAX_WIDTH}>
              <div style={{ position: "relative" }}>
                {renderRouteMapSvg({ showRoutes: true, stagger: false })}
                <div style={{ position: "absolute", inset: 0, background: "#000", opacity: 0.75 }} />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 56, fontWeight: 700 }}>{NTA_AVERAGE_MINUTES.toFixed(1)} min</div>
                  <p style={{ marginTop: 12, fontSize: 15, color: "#ccc" }}>
                    Elmhurst&apos;s average soccer travel time, weighted by each tract&apos;s population.
                  </p>
                  <p style={{ marginTop: 12, fontSize: 15, color: "#ccc" }}>
                    Every neighborhood&apos;s travel time, for every sport, is calculated the same way.
                  </p>
                </div>
              </div>
            </CenteredDiagram>,
          ]}
        />
        </div>
      )}
    </div>
  );
}
