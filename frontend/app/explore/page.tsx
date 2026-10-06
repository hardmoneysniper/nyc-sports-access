"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { useSelection, DEMOGRAPHIC_CATEGORIES, SPORT_TYPES } from "@/lib/selectionContext";
import { PERCENT_BIN_EDGES, BIN_COLORS, BURDEN_BIN_COLORS, BURDEN_BAND_LABELS, positiveQuantileBinEdges } from "@/lib/colorScale";
import { NTA_SOURCE_ID, MAPBOX_MAX_ZOOM } from "@/lib/mapboxConfig";
import { ntaCodeToFeatureId } from "@/lib/ntaId";
import { withBasePath } from "@/lib/basePath";
import type { SlotId, MapView, HoverInfo, ClickInfo } from "@/components/InteractiveMap";
import MapPageSidebar, { SIDEBAR_WIDTH } from "@/components/MapPageSidebar";
import MapMenuPanel, { PANEL_WIDTH } from "@/components/explore/MapMenuPanel";
import MapLegend from "@/components/explore/MapLegend";

const InteractiveMap = dynamic(() => import("@/components/InteractiveMap"), { ssr: false });

const SHOW_MENU_FONT_SIZE = 13;

type TooltipInfo = { slot: SlotId; ntaCode: string; lines: string[]; x: number; y: number };

// Builds the tooltip's lines from a feature's raw properties -- the same
// formatting is used for both hover and click, per project owner
// instruction, 2026-09-27 ("the window shown upon hover should be the
// same with the window shown upon clicking").
function formatTooltipLines(
  slot: SlotId,
  properties: Record<string, unknown>,
  demographicCategory: string | null,
  sportType: string | null
): string[] {
  const name = (properties.NTAName as string) ?? "Unknown";
  if (slot === "demographics") {
    const totalPopulation = properties.total_population;
    const populationLine =
      typeof totalPopulation === "number" ? `Total population: ${totalPopulation.toLocaleString()}` : "Total population: No data";
    const categoryLabel = DEMOGRAPHIC_CATEGORIES.find((c) => c.value === demographicCategory)?.label ?? demographicCategory ?? "";
    const categoryValue = demographicCategory ? properties[demographicCategory] : null;
    const categoryLine = `${categoryLabel}: ${typeof categoryValue === "number" ? `${categoryValue.toFixed(1)}%` : "No data"}`;
    return [name, populationLine, categoryLine];
  }
  const sportLabel = SPORT_TYPES.find((s) => s.value === sportType)?.label ?? sportType ?? "";
  const burdenIndex = sportType ? (properties[`burden_index_${sportType}`] as number | null | undefined) : null;
  // Exact raw score -- the map legend colors by percentile band
  // (colorForBurdenValue, via burdenBinEdges below), but the tooltip shows
  // the precise number. Per project owner instruction, 2026-09-29.
  const burdenLine = `${sportLabel} access burden index: ${typeof burdenIndex === "number" ? burdenIndex.toFixed(1) : "No data"}`;
  return [name, burdenLine];
}

const TOOLTIP_OFFSET = 14;

function NtaTooltip({ info }: { info: TooltipInfo }) {
  const elRef = useRef<HTMLDivElement>(null);
  // Defaults to the cursor's bottom-right, same as before -- corrected to
  // flip left/up (measured against the map panel's own box, which spans
  // the full page width for the rightmost panel) whenever the tooltip
  // would otherwise overflow past where the page clips it with
  // overflow:hidden. Runs in useLayoutEffect so the flip is applied before
  // paint, avoiding a visible jump. Per project owner report, 2026-09-28:
  // hovering rightmost NTAs pushed the tooltip off-screen.
  const [placement, setPlacement] = useState({ left: info.x + TOOLTIP_OFFSET, top: info.y + TOOLTIP_OFFSET });

  useLayoutEffect(() => {
    const el = elRef.current;
    const container = el?.parentElement;
    if (!el || !container) return;
    const containerRect = container.getBoundingClientRect();

    let left = info.x + TOOLTIP_OFFSET;
    if (left + el.offsetWidth > containerRect.width) {
      left = info.x - TOOLTIP_OFFSET - el.offsetWidth;
    }
    let top = info.y + TOOLTIP_OFFSET;
    if (top + el.offsetHeight > containerRect.height) {
      top = info.y - TOOLTIP_OFFSET - el.offsetHeight;
    }
    setPlacement({ left: Math.max(4, left), top: Math.max(4, top) });
  }, [info]);

  return (
    <div
      ref={elRef}
      style={{
        position: "absolute",
        left: placement.left,
        top: placement.top,
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
  const [menuOpen, setMenuOpen] = useState(true);
  const [burdenBinEdges, setBurdenBinEdges] = useState<number[] | null>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);

  const mapRefs = useRef<Record<SlotId, MapboxMap | null>>({ demographics: null, "travel-time": null });
  // The view both maps shared right before the current magnify -- captured
  // fresh at click time (not each map's own independently-recorded initial
  // fit, which could differ between the two -- see project owner report,
  // 2026-09-29, "the scale they shrink to is not universal").
  const preClickViewRef = useRef<MapView | null>(null);
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

  // Split view (both panes) exists whenever a demographic is picked --
  // the sport pane itself stays blank (baseOnly) until a sport is also
  // picked. Per project owner instruction, 2026-10-05.
  const dualSynced = demographicCategory !== null;
  const valueProperty = sportType ? `burden_index_${sportType}` : null;

  const handleMapReady = useCallback((slot: SlotId, map: MapboxMap | null) => {
    mapRefs.current[slot] = map;
    setMapReadyVersion((v) => v + 1);
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
      const otherSlot: SlotId = slot === "demographics" ? "travel-time" : "demographics";
      const otherMap = mapRefs.current[otherSlot];

      if (selectedIdRef.current === info.ntaCode) {
        // Toggle off -- shrink both maps back to the exact view they
        // shared right before the click, fading every NTA back to its
        // normal, uniform opacity.
        applyFeatureState(info.ntaCode, "selected", false);
        setDimming(false);
        selectedIdRef.current = null;
        selectedSlotRef.current = null;
        selectedInfoRef.current = null;
        const preClick = preClickViewRef.current;
        if (preClick) {
          map.easeTo({ center: preClick.center, zoom: preClick.zoom, duration: 1200 });
          otherMap?.easeTo({ center: preClick.center, zoom: preClick.zoom, duration: 1200 });
        }
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
      preClickViewRef.current = { center: map.getCenter().toArray() as [number, number], zoom: map.getZoom() };
      // Almost-fill-the-screen magnify -- padding is intentionally small.
      // Called directly on BOTH maps (not relayed via the "move" listener
      // below) so they animate in parallel from the same instant with
      // identical parameters, rather than one map leading and the other
      // reactively jumping a frame behind on every "move" tick -- per
      // project owner report, 2026-09-29, that relay-only approach had a
      // visible lag between the two, and could leave them at different
      // scales if either map's own recorded "initial view" ever diverged
      // from the other's.
      map.fitBounds(info.bounds, { padding: 40, duration: 1200, maxZoom: MAPBOX_MAX_ZOOM });
      otherMap?.fitBounds(info.bounds, { padding: 40, duration: 1200, maxZoom: MAPBOX_MAX_ZOOM });
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
    // No setState here when valueProperty is null -- the call sites below
    // already gate on `sportType` being set before reading burdenBinEdges,
    // so a stale value just sits unused rather than needing a reset.
    if (!valueProperty) return;
    let cancelled = false;
    fetch(withBasePath("/data/burden_index.geojson"))
      .then((res) => res.json())
      .then((data: GeoJSON.FeatureCollection) => {
        if (cancelled) return;
        const values = data.features.map((f) => f.properties?.[valueProperty] as number | null | undefined);
        // Equal-COUNT (quantile/percentile) bins for every sport, including
        // soccer -- the equal-WIDTH experiment was reverted. Per project
        // owner instruction, 2026-09-29.
        setBurdenBinEdges(positiveQuantileBinEdges(values));
      });
    return () => {
      cancelled = true;
    };
  }, [valueProperty]);

  const sportLabel = SPORT_TYPES.find((s) => s.value === sportType)?.label ?? "";
  const demographicLabel = DEMOGRAPHIC_CATEGORIES.find((c) => c.value === demographicCategory)?.label ?? "";

  return (
    <div style={{ position: "relative", height: "100vh", width: "100%", overflow: "hidden", display: "flex", background: "#000" }}>
      <MapPageSidebar />
      <MapMenuPanel
        open={menuOpen}
        sportType={sportType}
        onSportTypeChange={setSportType}
        demographicCategory={demographicCategory}
        onDemographicCategoryChange={setDemographicCategory}
      />
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        style={{
          position: "absolute",
          top: 0,
          left: SIDEBAR_WIDTH + (menuOpen ? PANEL_WIDTH : 0),
          transition: "left 300ms ease",
          zIndex: 1200,
          background: "#000",
          color: "#fff",
          border: "1px solid #fff",
          borderRadius: 2,
          padding: "8px 12px",
          fontSize: SHOW_MENU_FONT_SIZE,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
        }}
      >
        {menuOpen ? (
          <>
            <span aria-hidden>{"‹"}</span>
            Hide Menu
          </>
        ) : (
          <>
            Show Menu
            <span aria-hidden>{"›"}</span>
          </>
        )}
      </button>

      <div style={{ flex: 1, height: "100%", display: "flex" }}>
        <div style={{ flex: 1, height: "100%", position: "relative" }}>
          <InteractiveMap
            slot="travel-time"
            geojsonUrl={withBasePath("/data/burden_index.geojson")}
            valueProperty={valueProperty}
            binEdges={sportType ? burdenBinEdges : null}
            colorMode="positiveQuantile"
            baseOnly={!sportType}
            onMapReady={handleMapReady}
            onFeatureIdsReady={handleFeatureIdsReady}
            onHover={handleHover}
            onNtaClick={handleNtaClick}
          />
          {sportType && burdenBinEdges && (
            <MapLegend title={`${sportLabel} Access Burden`} colors={BURDEN_BIN_COLORS} labels={BURDEN_BAND_LABELS} />
          )}
          {tooltip?.slot === "travel-time" && <NtaTooltip info={tooltip} />}
        </div>
        {demographicCategory && (
          <div style={{ flex: 1, height: "100%", position: "relative" }}>
            <InteractiveMap
              slot="demographics"
              geojsonUrl={withBasePath("/data/demographics.geojson")}
              valueProperty={demographicCategory}
              binEdges={PERCENT_BIN_EDGES}
              onMapReady={handleMapReady}
              onFeatureIdsReady={handleFeatureIdsReady}
              onHover={handleHover}
              onNtaClick={handleNtaClick}
            />
            <MapLegend
              title={`${demographicLabel} (%)`}
              colors={BIN_COLORS}
              labels={PERCENT_BIN_EDGES.slice(1).map((edge) => String(edge))}
            />
            {tooltip?.slot === "demographics" && <NtaTooltip info={tooltip} />}
          </div>
        )}
      </div>
    </div>
  );
}
