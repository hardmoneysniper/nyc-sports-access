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
  const [routes, setRoutes] = useState<RouteDatum[] | null>(null);
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

  return { tracts, routes, facilityPoints };
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
  const { tracts, routes, facilityPoints } = useTravelTimeData();
  const activeIndex = useAutoLoop(SCENE_COUNT, 2000);

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

  const ready = tracts && routes && project;
  const routesActive = activeIndex === ROUTES_SCENE_INDEX;

  // Shared between the route-reveal scene and the final scene's backdrop
  // (the "completed route visualization" behind the average-minutes
  // number), so the two don't drift out of sync with each other. Per
  // project owner instruction, 2026-10-05.
  function renderRouteMapSvg({ showRoutes, stagger }: { showRoutes: boolean; stagger: boolean }) {
    return (
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width: "100%", height: "auto", display: "block" }}>
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

            renderRouteMapSvg({ showRoutes: routesActive, stagger: true }),

            <div key="s3" style={{ position: "relative", width: "100%" }}>
              {renderRouteMapSvg({ showRoutes: true, stagger: false })}
              <div style={{ position: "absolute", inset: 0, background: "#000", opacity: 0.75 }} />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ fontSize: 48, fontWeight: 700, color: "#fff" }}>{NTA_AVERAGE_MINUTES.toFixed(1)} min</div>
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
        >
              <Prose style={{ marginTop: 0 }}>
                Residents at opposite ends of a neighborhood can have very different trips, so a single starting
                point cannot represent everyone&apos;s access. Each <u>Neighborhood Tabulation Area (NTA)</u> is made
                up of smaller geographic areas called <u>census tracts</u>. We use each tract&apos;s midpoint as the
                starting point to calculate travel time to the nearest public sports facility, then take a{" "}
                <u>population</u>-weighted average for the NTA, giving more weight to tracts with more residents.
              </Prose>
            </SplitPanel>
          </div>
        </>
      )}
    </div>
  );
}
