"use client";

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/basePath";
import SplitPanel from "./SplitPanel";
import { useAutoLoop } from "./useAutoLoop";
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
// Internal SVG coordinate system only -- the rendered size is controlled
// by SplitPanel's bordered box (CSS), not this value directly.
const MAP_W = 640;
// Shorter than a 4:3 canvas (was 480) -- Elmhurst's real geographic
// extent is much wider than tall (~2.8:1), so makeCenteredProjector's
// width-constrained scale already filled the canvas's full width; a
// taller canvas just meant more unused vertical margin inside the box,
// which read as the map looking small/narrow relative to the box.
// Reported live, 2026-10-08.
const MAP_H = 360;
const SCENE_COUNT = 4;
const ROUTES_SCENE_INDEX = 2;

type TractDatum = { geoid: string; ring: LngLat[]; centroid: LngLat };
type RouteSegment = { mode: string; coords: LngLat[] };
type RouteDatum = { geoid: string; facilityId: string; totalMinutes: number; segments: RouteSegment[] };

function useTravelTimeData() {
  const [tracts, setTracts] = useState<TractDatum[] | null>(null);
  const [ntaBoundary, setNtaBoundary] = useState<LngLat[] | null>(null);
  const [routes, setRoutes] = useState<RouteDatum[] | null>(null);
  const [facilityPoints, setFacilityPoints] = useState<Map<string, LngLat> | null>(null);

  useEffect(() => {
    let cancelled = false;

    // The dot shown for each tract is its real routing origin (shapely's
    // representative_point(), computed once by scripts/extract_elmhurst_
    // tract_origins.py using the actual pipeline.offsets.compute_origin_
    // point function) -- not the frontend's own recomputed area-weighted
    // polygon centroid, which can land tens to hundreds of meters away for
    // an irregularly-shaped tract and doesn't match what travel times are
    // actually calculated from. Falls back to the geometric centroid only
    // if a tract's real origin is somehow missing. Per project owner
    // instruction, 2026-10-14 ("use the actual origin for the location of
    // these dots").
    Promise.all([
      fetch(withBasePath(`/data/tracts/${ELMHURST_ID}.geojson`)).then((r) => r.json()),
      fetch(withBasePath(`/data/tracts/${ELMHURST_ID}_origins.geojson`)).then((r) => r.json()),
    ]).then(([d, origins]: [GeoJSON.FeatureCollection, GeoJSON.FeatureCollection]) => {
      if (cancelled) return;
      const originByGeoid = new Map<string, LngLat>();
      for (const f of origins.features) {
        originByGeoid.set(f.properties?.GEOID as string, (f.geometry as GeoJSON.Point).coordinates as LngLat);
      }
      const parsed: TractDatum[] = d.features.map((f) => {
        const ring = exteriorRingOf(f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon);
        const geoid = f.properties?.GEOID as string;
        return { geoid, ring, centroid: originByGeoid.get(geoid) ?? polygonCentroid(ring) };
      });
      setTracts(parsed);
    });

    // Elmhurst's single NTA-level outer edge (scripts/extract_elmhurst_nta_
    // boundary.py), not each tract's own internal boundary -- the
    // route-reveal scene shows the neighborhood's one outer edge, with
    // tract centroid dots inside it, instead of a grid of per-tract lines.
    // Per project owner instruction, 2026-10-14 ("only show the outer
    // boundary of the nta").
    fetch(withBasePath(`/data/tracts/${ELMHURST_ID}_boundary.geojson`))
      .then((r) => r.json())
      .then((d: GeoJSON.FeatureCollection) => {
        if (cancelled) return;
        setNtaBoundary(exteriorRingOf(d.features[0].geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon));
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

  return { tracts, ntaBoundary, routes, facilityPoints };
}

// Pre-rasterized once by scripts/render_elmhurst_roads_png.py from the same
// real OSM street geometry (scripts/extract_elmhurst_roads.py), using the
// exact same projection math (geoProjection.ts's makeCenteredProjector,
// same MAP_W/MAP_H/padding) so it lines up pixel-for-pixel with the live
// tract/route/facility SVG overlays drawn on top of it. Was a live SVG
// <path> of ~9,000 road segments, re-rasterized as vector geometry on every
// resize -- including the page's own menu-collapse animation, which
// continuously resizes this box for ~300ms. A static image resizes via
// cheap bitmap scaling instead of re-rasterizing ~9,000 segments' worth of
// vector paths every frame. Must be regenerated if MAP_W/MAP_H/padding ever
// change. Per project owner instruction, 2026-10-08 ("is it possible to
// use a png instead... the road network does not change across all
// frames").
const ROADS_BACKDROP_SRC = withBasePath("/imgs/elmhurst_roads_backdrop.png");

function Prose({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ fontSize: 18, lineHeight: 1.65, color: "#ccc", marginTop: 12, ...style }}>{children}</p>;
}

export default function TravelTimeTab() {
  const { tracts, ntaBoundary, routes, facilityPoints } = useTravelTimeData();
  const activeIndex = useAutoLoop(SCENE_COUNT, 5000);

  const facilityCoords = useMemo(() => {
    if (!routes || !facilityPoints) return [];
    const ids = Array.from(new Set(routes.map((r) => r.facilityId)));
    return ids.map((id) => facilityPoints.get(id)).filter((p): p is LngLat => !!p);
  }, [routes, facilityPoints]);

  // Real route geometry starts at whatever street/transit access point r5py
  // snapped the origin to, which can be a short (but visible, at this
  // map's scale) walk from the dot itself -- prepending the origin to the
  // route's geometry (tried first) just turned that gap into an obviously
  // fake dead-straight "spike" sticking out of the dot for any tract where
  // the gap was more than a few meters, which read as the exact "protruding
  // line" being reported, not a fix for it. For this illustrative diagram,
  // the dot shown alongside routes (s2) is instead the route's own real
  // first coordinate -- wherever its actual walk leg starts -- so the dot
  // and the line are the same point by construction, with nothing
  // synthesized to bridge them. Showcase purposes only: s0/s1 (no routes
  // drawn) still show each tract's true routing origin, unaffected. Per
  // project owner instruction, 2026-10-14 ("make the rendered routes...
  // only start from the dots"; "there is still a protruding line out of
  // the centroids").
  const routeStartByGeoid = useMemo(() => {
    const map = new Map<string, LngLat>();
    routes?.forEach((r) => {
      const firstCoord = r.segments[0]?.coords[0];
      if (firstCoord) map.set(r.geoid, firstCoord);
    });
    return map;
  }, [routes]);

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

  const ready = tracts && ntaBoundary && routes && project;
  const routesActive = activeIndex === ROUTES_SCENE_INDEX;

  // Shared between the route-reveal scene and the final scene's backdrop
  // (the "completed route visualization" behind the average-minutes
  // number), so the two don't drift out of sync with each other. Per
  // project owner instruction, 2026-10-05.
  function renderRouteMapSvg({
    showRoutes,
    stagger,
    showCentroidDots = false,
  }: {
    showRoutes: boolean;
    stagger: boolean;
    // Swaps the per-tract boundary outlines for the NTA's single outer
    // edge plus tract centroid dots (matching s0/s1's dot style) -- used by
    // both the route-reveal scene (s2) AND its reuse as the final scene's
    // dimmed backdrop (s3), so the two stay visually identical underneath
    // the dimming/number overlay. Per project owner instruction, 2026-10-14
    // ("remove the boundary line on the 3rd frame... show the dots
    // representing centroids of tracts instead"; "only show the outer
    // boundary of the nta"; "keep the underlying visualization for frame 4
    // the same as the one on frame 3").
    showCentroidDots?: boolean;
  }) {
    return (
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {showCentroidDots ? (
          <>
            <polygon
              points={ntaBoundary!.map((p) => project!(p).join(",")).join(" ")}
              fill="#fff"
              fillOpacity={0.05}
              stroke="#fff"
              strokeOpacity={0.25}
              strokeWidth={1}
            />
            {tracts!.map((t) => {
              const [x, y] = project!(routeStartByGeoid.get(t.geoid) ?? t.centroid);
              return <circle key={t.geoid} cx={x} cy={y} r={3} fill="#fff" />;
            })}
          </>
        ) : (
          tracts!.map((t) => (
            <polygon
              key={t.geoid}
              points={t.ring.map((p) => project!(p).join(",")).join(" ")}
              fill="none"
              stroke="#fff"
              strokeOpacity={0.25}
              strokeWidth={1}
            />
          ))
        )}
        {routes!.map((r, i) => (
          <g
            key={r.geoid}
            style={{
              opacity: showRoutes ? 1 : 0,
              transition: stagger ? `opacity 400ms ease ${i * 15}ms` : undefined,
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
      {!ready && (
        <>
          <h1 style={{ fontSize: 48, fontWeight: 700, margin: 0 }}>Travel Time</h1>
          <p style={{ color: "#777", marginTop: 40 }}>Loading data…</p>
        </>
      )}

      {ready && (
        <>
          <h1 style={{ fontSize: 48, fontWeight: 700, margin: 0 }}>Travel Time</h1>
          <div style={{ marginTop: 32 }}>
            <SplitPanel
              activeIndex={activeIndex}
              backdrop={
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ROADS_BACKDROP_SRC}
                  alt=""
                  aria-hidden
                  style={{ width: "100%", height: "auto", display: "block" }}
                />
              }
              scenes={[
            <svg key="s0" viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width: "100%", height: "auto", display: "block" }}>
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
            </svg>,

            <svg key="s1" viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width: "100%", height: "auto", display: "block" }}>
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
            </svg>,

            renderRouteMapSvg({ showRoutes: routesActive, stagger: true, showCentroidDots: true }),

            <div key="s3" style={{ position: "relative", width: "100%" }}>
              {renderRouteMapSvg({ showRoutes: true, stagger: false, showCentroidDots: true })}
              <div style={{ position: "absolute", inset: 0, background: "#000", opacity: 0.75 }} />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 48, fontWeight: 700, color: "#fff" }}>{NTA_AVERAGE_MINUTES.toFixed(1)} min</div>
                {/* Small, static copy of the last rolling caption, right
                    under the number itself -- the rolling caption strip
                    below the whole animation box keeps rolling in sync
                    with every scene exactly as before; this is in addition
                    to that, not a replacement. Per project owner
                    instruction, 2026-10-14. */}
                <div style={{ fontSize: 13, color: "#ccc", textAlign: "center", maxWidth: 280 }}>
                  Elmhurst&apos;s average soccer travel time, weighted by each tract&apos;s population.
                </div>
              </div>
            </div>,
          ]}
          captions={[
            <>Elmhurst&apos;s {tracts!.length} census tracts, each with its own center point.</>,
            <>Each tract&apos;s nearest soccer facility (squares) is found separately.</>,
            <>Calculate every tract&apos;s travel route and time to its nearest facility, by transit.</>,
            <>Elmhurst&apos;s average soccer travel time, weighted by each tract&apos;s population.</>,
          ]}
          aspectRatio={`${MAP_W} / ${MAP_H}`}
          layout="column"
        >
              <Prose style={{ marginTop: 0 }}>
                Residents at opposite ends of a neighborhood can have very different trips, so a single starting
                point cannot represent everyone&apos;s access. Each <u>Neighborhood Tabulation Area (NTA)</u> is made
                up of smaller geographic areas called <u>census tracts</u>. We use each tract&apos;s midpoint as the
                starting point to calculate travel time to the nearest public sports facility. Travel times are
                computed from{" "}
                <a
                  href="https://www.mta.info/developers"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#ccc", textDecoration: "underline" }}
                >
                  real transit schedules
                </a>{" "}
                (the subway, every city bus route, and NYC Ferry) and the
                actual street and path network from OpenStreetMap, combined with an open-source routing engine
                that simulates real trips (walking, waiting for and riding transit, and walking again) rather than
                estimating distance as the crow flies. We then take a{" "}
                <u>population</u>-weighted average for the NTA, giving more weight to tracts with more residents.
              </Prose>
            </SplitPanel>
          </div>
        </>
      )}
    </div>
  );
}
