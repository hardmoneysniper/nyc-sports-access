"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { useSelection, DEMOGRAPHIC_CATEGORIES, SPORT_TYPES } from "@/lib/selectionContext";
import { PERCENT_BIN_EDGES, quantileBinEdges } from "@/lib/colorScale";
import { NTA_SOURCE_ID, MAPBOX_MAX_ZOOM } from "@/lib/mapboxConfig";
import { ntaCodeToFeatureId } from "@/lib/ntaId";
import { withBasePath } from "@/lib/basePath";
import type { SlotId, MapView, HoverInfo, ClickInfo } from "@/components/InteractiveMap";

const InteractiveMap = dynamic(() => import("@/components/InteractiveMap"), { ssr: false });

type TooltipInfo = { slot: SlotId; ntaCode: string; lines: string[]; x: number; y: number };

// Builds the tooltip's lines from a feature's raw properties -- the same
// formatting is used for both hover and click, per project owner
// instruction, 2026-09-27 ("the window shown upon hover should be the
// same with the window shown upon clicking").
function formatTooltipLines(
  slot: SlotId,
  properties: Record<string, unknown>,
  demographicCategory: string,
  sportType: string
): string[] {
  const name = (properties.NTAName as string) ?? "Unknown";
  if (slot === "demographics") {
    const totalPopulation = properties.total_population;
    const populationLine =
      typeof totalPopulation === "number" ? `Total population: ${totalPopulation.toLocaleString()}` : "Total population: No data";
    const categoryLabel = DEMOGRAPHIC_CATEGORIES.find((c) => c.value === demographicCategory)?.label ?? demographicCategory;
    const categoryValue = properties[demographicCategory];
    const categoryLine = `${categoryLabel}: ${typeof categoryValue === "number" ? `${categoryValue.toFixed(1)}%` : "No data"}`;
    return [name, populationLine, categoryLine];
  }
  const sportLabel = (SPORT_TYPES.find((s) => s.value === sportType)?.label ?? sportType).toLowerCase();
  const travelTime = properties[`travel_time_${sportType}`];
  const travelTimeLine =
    typeof travelTime === "number"
      ? `Travel time to nearest ${sportLabel} facility: ${travelTime.toFixed(1)} min`
      : `Travel time to nearest ${sportLabel} facility: No data`;
  return [name, travelTimeLine];
}

function NtaTooltip({ info }: { info: TooltipInfo }) {
  return (
    <div
      style={{
        position: "absolute",
        left: info.x + 14,
        top: info.y + 14,
        zIndex: 1000,
        background: "white",
        color: "#111",
        padding: "6px 10px",
        borderRadius: 4,
        fontSize: 13,
        pointerEvents: "none",
        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
        whiteSpace: "nowrap",
      }}
    >
      {info.lines.map((line, i) => (
        <div key={i} style={i === 0 ? { fontWeight: 700 } : undefined}>
          {line}
        </div>
      ))}
    </div>
  );
}

export default function ExplorePage() {
  const { demographicCategory, setDemographicCategory, sportType, setSportType } = useSelection();
  const [showDemographics, setShowDemographics] = useState(true);
  const [showTravelTime, setShowTravelTime] = useState(true);
  const [travelTimeBinEdges, setTravelTimeBinEdges] = useState<number[] | null>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);

  const mapRefs = useRef<Record<SlotId, MapboxMap | null>>({ demographics: null, "travel-time": null });
  const initialViewsRef = useRef<Record<SlotId, MapView | null>>({ demographics: null, "travel-time": null });
  const selectedIdRef = useRef<string | null>(null);
  const selectedSlotRef = useRef<SlotId | null>(null);
  const selectedInfoRef = useRef<{ lines: string[]; x: number; y: number } | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  // Every NTA code, used purely to drive setDimming (it needs to touch
  // every feature, not just the selected one). Populated once each slot's
  // data loads; demographics/travel-time cover the same 262 NTAs, so
  // whichever arrives is fine as the shared list.
  const allNtaCodesRef = useRef<string[]>([]);
  const [mapReadyVersion, setMapReadyVersion] = useState(0);

  const valueProperty = `travel_time_${sportType}`;
  const dualSynced = showDemographics && showTravelTime;
  const showBaseOnly = !showDemographics && !showTravelTime;

  const handleMapReady = useCallback((slot: SlotId, map: MapboxMap | null) => {
    mapRefs.current[slot] = map;
    setMapReadyVersion((v) => v + 1);
  }, []);

  const handleInitialViewReady = useCallback((slot: SlotId, view: MapView) => {
    initialViewsRef.current[slot] = view;
  }, []);

  const handleFeatureIdsReady = useCallback((_slot: SlotId, ntaCodes: string[]) => {
    if (allNtaCodesRef.current.length === 0) allNtaCodesRef.current = ntaCodes;
  }, []);

  // Applies a feature-state flag (hover/selected) to the NTA with this id
  // on EVERY currently-mounted map -- this is what makes the highlight
  // border show identically on both maps regardless of which one the
  // cursor/click actually happened on. Per project owner instruction,
  // 2026-09-27.
  const applyFeatureState = useCallback((ntaCode: string, key: "hover" | "selected", value: boolean) => {
    const id = ntaCodeToFeatureId(ntaCode);
    (Object.values(mapRefs.current) as (MapboxMap | null)[]).forEach((map) => {
      if (!map) return;
      map.setFeatureState({ source: NTA_SOURCE_ID, id }, { [key]: value });
    });
  }, []);

  // Toggles every NTA's "dimmed" feature-state on/off (the fill-opacity
  // expression itself is fixed, set once in InteractiveMap -- see the
  // comment there on why swapping the whole expression via
  // setPaintProperty broke the fade transition). Setting "dimmed" on the
  // selected feature too is harmless: the expression checks "selected"
  // first, so it stays fully opaque regardless. Per project owner
  // instruction, 2026-09-27 ("only the focused NTA should have 100%
  // opacity... everything else smoothly dimmed").
  const setDimming = useCallback((dimmed: boolean) => {
    const maps = Object.values(mapRefs.current) as (MapboxMap | null)[];
    for (const code of allNtaCodesRef.current) {
      const id = ntaCodeToFeatureId(code);
      for (const map of maps) {
        if (!map) continue;
        map.setFeatureState({ source: NTA_SOURCE_ID, id }, { dimmed });
      }
    }
  }, []);

  const handleHover = useCallback(
    (slot: SlotId, info: HoverInfo | null) => {
      const prevHoverId = hoveredIdRef.current;
      if (info) {
        if (prevHoverId && prevHoverId !== info.ntaCode) applyFeatureState(prevHoverId, "hover", false);
        if (prevHoverId !== info.ntaCode) applyFeatureState(info.ntaCode, "hover", true);
        hoveredIdRef.current = info.ntaCode;
        setTooltip({
          slot,
          ntaCode: info.ntaCode,
          lines: formatTooltipLines(slot, info.properties, demographicCategory, sportType),
          x: info.x,
          y: info.y,
        });
        return;
      }
      if (prevHoverId) applyFeatureState(prevHoverId, "hover", false);
      hoveredIdRef.current = null;
      // Hover ended -- if an NTA is still selected, restore its (sticky)
      // tooltip instead of just hiding it. Per project owner instruction,
      // 2026-09-27 ("only 1 window ... the difference is hover doesn't
      // magnify and clicking does").
      if (selectedIdRef.current && selectedSlotRef.current && selectedInfoRef.current) {
        setTooltip({ slot: selectedSlotRef.current, ntaCode: selectedIdRef.current, ...selectedInfoRef.current });
      } else {
        setTooltip(null);
      }
    },
    [applyFeatureState, demographicCategory, sportType]
  );

  const handleNtaClick = useCallback(
    (slot: SlotId, info: ClickInfo) => {
      const map = mapRefs.current[slot];
      if (!map) return;

      if (selectedIdRef.current === info.ntaCode) {
        // Toggle off -- shrink back to the original (pre-click) scale and
        // fade every NTA back to its normal, uniform opacity.
        applyFeatureState(info.ntaCode, "selected", false);
        setDimming(false);
        selectedIdRef.current = null;
        selectedSlotRef.current = null;
        selectedInfoRef.current = null;
        const initial = initialViewsRef.current[slot];
        if (initial) map.easeTo({ center: initial.center, zoom: initial.zoom, duration: 1200 });
        setTooltip(null);
        return;
      }

      if (selectedIdRef.current) applyFeatureState(selectedIdRef.current, "selected", false);
      selectedIdRef.current = info.ntaCode;
      selectedSlotRef.current = slot;
      const lines = formatTooltipLines(slot, info.properties, demographicCategory, sportType);
      selectedInfoRef.current = { lines, x: info.x, y: info.y };
      applyFeatureState(info.ntaCode, "selected", true);
      setDimming(true);
      // Almost-fill-the-screen magnify -- padding is intentionally small.
      // The other (synced) map mirrors this in real time via the "move"
      // relay below, frame by frame, since Mapbox (unlike Leaflet's CSS3
      // zoom transition) fires "move" continuously during flyTo/fitBounds
      // too. Per project owner instruction, 2026-09-27.
      map.fitBounds(info.bounds, { padding: 40, duration: 1200, maxZoom: MAPBOX_MAX_ZOOM });
      setTooltip({ slot, ntaCode: info.ntaCode, lines, x: info.x, y: info.y });
    },
    [applyFeatureState, setDimming, demographicCategory, sportType]
  );

  // Real-time camera link between the two maps: dragging, scroll-zooming,
  // or an NTA-click magnify/shrink on EITHER map relays to the other via
  // Mapbox's "move" event, which (unlike Leaflet) fires continuously for
  // every kind of camera change, animated or not -- so a plain jumpTo
  // relay is enough to keep both maps moving together in lockstep for
  // every case, with no separate handling needed for zoom vs pan vs
  // programmatic flyTo. Per project owner instruction, 2026-09-27.
  useEffect(() => {
    if (!dualSynced) return;
    const mapA = mapRefs.current.demographics;
    const mapB = mapRefs.current["travel-time"];
    if (!mapA || !mapB) return;

    let syncSource: "a" | "b" | null = null;
    const fromA = () => {
      if (syncSource === "b") return;
      syncSource = "a";
      mapB.jumpTo({ center: mapA.getCenter(), zoom: mapA.getZoom() });
      syncSource = null;
    };
    const fromB = () => {
      if (syncSource === "a") return;
      syncSource = "b";
      mapA.jumpTo({ center: mapB.getCenter(), zoom: mapB.getZoom() });
      syncSource = null;
    };
    mapA.on("move", fromA);
    mapB.on("move", fromB);
    mapB.jumpTo({ center: mapA.getCenter(), zoom: mapA.getZoom() });

    return () => {
      mapA.off("move", fromA);
      mapB.off("move", fromB);
    };
  }, [dualSynced, mapReadyVersion]);

  useEffect(() => {
    let cancelled = false;
    fetch(withBasePath("/data/travel_time.geojson"))
      .then((res) => res.json())
      .then((data: GeoJSON.FeatureCollection) => {
        if (cancelled) return;
        const values = data.features.map((f) => f.properties?.[valueProperty] as number | null | undefined);
        setTravelTimeBinEdges(quantileBinEdges(values));
      });
    return () => {
      cancelled = true;
    };
  }, [valueProperty]);

  return (
    <div style={{ position: "relative", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 1000,
          background: "white",
          padding: "10px 12px",
          borderRadius: 4,
          fontSize: 13,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
          color: "#111",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={showDemographics} onChange={(e) => setShowDemographics(e.target.checked)} />
          Demographics
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={showTravelTime} onChange={(e) => setShowTravelTime(e.target.checked)} />
          Travel Time
        </label>
        {showDemographics && (
          <div>
            <label htmlFor="category-select">Demographic: </label>
            <select
              id="category-select"
              value={demographicCategory}
              onChange={(e) => setDemographicCategory(e.target.value as typeof demographicCategory)}
            >
              {DEMOGRAPHIC_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {showTravelTime && (
          <div>
            <label htmlFor="sport-select">Sport facility type: </label>
            <select id="sport-select" value={sportType} onChange={(e) => setSportType(e.target.value as typeof sportType)}>
              {SPORT_TYPES.map((sport) => (
                <option key={sport.value} value={sport.value}>
                  {sport.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div style={{ height: "100%", display: "flex" }}>
        {showTravelTime && (
          <div style={{ flex: 1, height: "100%", position: "relative" }}>
            <InteractiveMap
              slot="travel-time"
              geojsonUrl={withBasePath("/data/travel_time.geojson")}
              valueProperty={valueProperty}
              binEdges={travelTimeBinEdges}
              onMapReady={handleMapReady}
              onInitialViewReady={handleInitialViewReady}
              onFeatureIdsReady={handleFeatureIdsReady}
              onHover={handleHover}
              onNtaClick={handleNtaClick}
            />
            {tooltip?.slot === "travel-time" && <NtaTooltip info={tooltip} />}
          </div>
        )}
        {showDemographics && (
          <div style={{ flex: 1, height: "100%", position: "relative" }}>
            <InteractiveMap
              slot="demographics"
              geojsonUrl={withBasePath("/data/demographics.geojson")}
              valueProperty={demographicCategory}
              binEdges={PERCENT_BIN_EDGES}
              onMapReady={handleMapReady}
              onInitialViewReady={handleInitialViewReady}
              onFeatureIdsReady={handleFeatureIdsReady}
              onHover={handleHover}
              onNtaClick={handleNtaClick}
            />
            {tooltip?.slot === "demographics" && <NtaTooltip info={tooltip} />}
          </div>
        )}
        {showBaseOnly && (
          <div style={{ flex: 1, height: "100%" }}>
            <InteractiveMap slot="demographics" geojsonUrl="" valueProperty={null} binEdges={null} baseOnly />
          </div>
        )}
      </div>
    </div>
  );
}
