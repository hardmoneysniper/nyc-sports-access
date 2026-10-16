"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { useSelection, DEMOGRAPHIC_CATEGORIES, SPORT_TYPES } from "@/lib/selectionContext";
import { PERCENT_BIN_EDGES, BIN_COLORS, BURDEN_BIN_COLORS, BURDEN_BAND_LABELS, positiveQuantileBinEdges } from "@/lib/colorScale";
import { NTA_SOURCE_ID, MAPBOX_MAX_ZOOM } from "@/lib/mapboxConfig";
import { ntaCodeToFeatureId } from "@/lib/ntaId";
import { featureCollectionBounds, zoomToFitBounds } from "@/lib/geoBounds";
import { rankInvestmentPriorities, type InvestmentPriority } from "@/lib/investmentPriorities";
import { withBasePath } from "@/lib/basePath";
import type { SlotId, MapView, HoverInfo, ClickInfo } from "@/components/InteractiveMap";
import MapPageSidebar, { SIDEBAR_WIDTH } from "@/components/MapPageSidebar";
import MapMenuPanel, { PANEL_WIDTH } from "@/components/explore/MapMenuPanel";
import MapLegend from "@/components/explore/MapLegend";
import DashboardView from "@/components/explore/DashboardView";

const InteractiveMap = dynamic(() => import("@/components/InteractiveMap"), { ssr: false });

const SHOW_MENU_FONT_SIZE = 13;

type TooltipInfo = { slot: SlotId; ntaCode: string; lines: string[]; x: number; y: number };

// Replaces the "‹"/"›" text glyphs the Hide/Show Menu button used to show
// -- a font glyph's visual weight isn't geometrically centered within its
// own character box, so the arrow read as off-center no matter how the
// surrounding flex row was aligned. An SVG path has no such ambiguity: it's
// centered by construction. Reported live, 2026-10-08 ("absolutely
// centrally align the arrows for hide menu and show menu buttons").
function MenuArrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width={8} height={12} viewBox="0 0 8 12" fill="none" aria-hidden style={{ display: "block" }}>
      <path
        d={direction === "left" ? "M6.5 1L1.5 6L6.5 11" : "M1.5 1L6.5 6L1.5 11"}
        stroke="#fff"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  const [highlightPriorities, setHighlightPriorities] = useState(false);
  const [menuOpen, setMenuOpen] = useState(true);
  const [view, setView] = useState<"map" | "charts">("map");
  const [priorities, setPriorities] = useState<{ property: string; rows: InvestmentPriority[] } | null>(null);
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

  // Demographics' own bounds and the exact zoom a half-width pane needs to
  // fit them -- computed via pure Web Mercator math (zoomToFitBounds, the
  // same formula Mapbox GL itself uses for fitBounds at bearing/pitch 0),
  // not a live headless map. A hidden, headless mapboxgl.Map was tried
  // first for this and kept landing late or not applying at all --
  // plausibly because the browser/mapbox-gl don't fully render/load a
  // style for a visibility:hidden, non-interactive canvas the same way as
  // a visible one. Pure arithmetic has no such dependency: given the
  // bounds and a target container size, the answer is synchronous and
  // deterministic. Both the single-pane (burden map alone, full-width) and
  // dual-pane (both maps, half-width) views get locked to this SAME
  // number, so there's only ever one "smallest scale." Reported live,
  // 2026-10-12 ("it still does not start at the floor scale right now").
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const [demoBounds, setDemoBounds] = useState<[[number, number], [number, number]] | null>(null);
  const [contentSize, setContentSize] = useState<{ width: number; height: number } | null>(null);
  const minZoomAppliedRef = useRef<Partial<Record<SlotId, boolean>>>({});

  useEffect(() => {
    let cancelled = false;
    fetch(withBasePath("/data/demographics.geojson"))
      .then((res) => res.json())
      .then((data: GeoJSON.FeatureCollection) => {
        if (!cancelled) setDemoBounds(featureCollectionBounds(data));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The content area's own current size, in pixels -- half of its width is
  // exactly what a real dual-pane half-pane would be. Measured directly
  // (not derived from SIDEBAR_WIDTH/PANEL_WIDTH constants) so it stays
  // correct regardless of viewport size or whether the catalog is open.
  useEffect(() => {
    const el = contentAreaRef.current;
    if (!el) return;
    const measure = () => setContentSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const referenceMinZoom =
    demoBounds && contentSize
      ? zoomToFitBounds(demoBounds, contentSize.width / 2, contentSize.height, 10, MAPBOX_MAX_ZOOM)
      : null;

  // Split view (both panes) exists whenever a demographic is picked --
  // the sport pane itself stays blank (baseOnly) until a sport is also
  // picked. Per project owner instruction, 2026-10-05.
  const dualSynced = demographicCategory !== null;
  const valueProperty = sportType ? `burden_index_${sportType}` : null;

  const handleMapReady = useCallback((slot: SlotId, map: MapboxMap | null) => {
    mapRefs.current[slot] = map;
    // A district can already be focused on the OTHER map before this one
    // even mounts -- e.g. clicking an NTA on the Burden Score map, then
    // turning on a Demographic category afterward. applyFeatureState/
    // setDimming only ever reach maps that already existed in mapRefs at
    // the moment they were called, so this map's own copy of the
    // "selected"/"dimmed" feature-state would otherwise start empty --
    // every NTA shown at full, un-highlighted opacity, contradicting the
    // already-focused state on the other map. Per project owner report,
    // 2026-10-16 ("the demographic map is not focused on that focused
    // district").
    if (map && selectedIdRef.current) {
      for (const code of allNtaCodesRef.current) {
        map.setFeatureState({ source: NTA_SOURCE_ID, id: ntaCodeToFeatureId(code) }, { dimmed: true });
      }
      map.setFeatureState({ source: NTA_SOURCE_ID, id: ntaCodeToFeatureId(selectedIdRef.current) }, { selected: true });
    }
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

  const canShowStats = useCallback((slot: SlotId, ntaCode: string) =>
    slot === "demographics" || !highlightPriorities || !sportType ||
    (priorities?.property === valueProperty && priorities.rows.some((row) => row.id === ntaCode)),
  [highlightPriorities, sportType, priorities, valueProperty]);

  const handleHover = useCallback(
    (slot: SlotId, info: HoverInfo | null) => {
      if (info && !canShowStats(slot, info.ntaCode)) info = null;
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
      if (selectedIdRef.current && selectedSlotRef.current && canShowStats(selectedSlotRef.current, selectedIdRef.current) && selectedInfoRef.current) {
        setTooltip({ slot: selectedSlotRef.current, ntaCode: selectedIdRef.current, ...selectedInfoRef.current });
      } else {
        setTooltip(null);
      }
    },
    [applyFeatureState, demographicCategory, sportType, canShowStats]
  );

  const handleNtaClick = useCallback(
    (slot: SlotId, info: ClickInfo) => {
      const map = mapRefs.current[slot];
      if (!map) return;
      const otherSlot: SlotId = slot === "demographics" ? "travel-time" : "demographics";
      const otherMap = mapRefs.current[otherSlot];

      // Only the ALREADY-focused NTA's own click can do anything while a
      // district is focused -- clicking any OTHER NTA is ignored outright,
      // rather than the seemingly more natural "just re-target focus to
      // whichever NTA was clicked next" (which is what falling through to
      // the fitBounds-to-new-bounds logic below would do regardless of
      // whether something was already selected). Narrowing the focused
      // state's interaction surface down to a single click target this
      // way is a deliberate isolation step for a separate edge-case bug
      // under investigation: it rules "clicking a second NTA while one is
      // already focused" in or out as a contributing cause. Per project
      // owner report, 2026-10-16.
      if (selectedIdRef.current && selectedIdRef.current !== info.ntaCode) return;

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
  //
  // Before linking cameras, also re-applies the measured referenceMinZoom
  // to demographics (belt-and-suspenders -- it should already match its
  // own self-computed floor exactly, since it always mounts at the real
  // half-width size, but this guarantees it regardless). This MUST run
  // before the jumpTo below, not after -- jumpTo-ing to a zoom below the
  // map's CURRENT minZoom gets silently clamped back up, so relaxing the
  // floor in a separate, later effect previously left the default view
  // stuck above the floor instead of landing on it. Reported live,
  // 2026-10-11/2026-10-12.
  useEffect(() => {
    if (!dualSynced) return;
    const mapA = mapRefs.current.demographics;
    const mapB = mapRefs.current["travel-time"];
    if (!mapA || !mapB) return;

    if (referenceMinZoom !== null) {
      mapA.setMinZoom(referenceMinZoom);
      mapB.setMinZoom(referenceMinZoom);
    }

    // If a district is already focused (e.g. clicked on Burden Score
    // before turning on a Demographic category), match that focused view
    // on setup instead of letting demographics' own freshly-mounted
    // default view become the new ground truth both maps snap to below.
    // Per project owner report, 2026-10-16.
    if (selectedSlotRef.current && selectedIdRef.current) {
      const focusedMap = mapRefs.current[selectedSlotRef.current];
      if (focusedMap) {
        const view = { center: focusedMap.getCenter(), zoom: focusedMap.getZoom() };
        mapA.jumpTo(view);
        mapB.jumpTo(view);
      }
    }

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
  }, [dualSynced, mapReadyVersion, referenceMinZoom]);

  // Single-pane case: applies the same measured referenceMinZoom directly
  // to whichever map is up (normally just travel-time, mounted alone
  // before any demographic is picked) as both its default view AND its
  // floor, so the very first thing a visitor sees is already at the same
  // scale dual-pane view would later lock it to -- not a tighter,
  // full-width-only fit that then visibly snaps out once a demographic is
  // selected. setMinZoom MUST run before setZoom, not after -- the map's
  // CURRENT minZoom is still its old (tighter) self-computed value at this
  // point, so setZoom to a MORE zoomed-out target gets silently clamped
  // back up to that old floor; setMinZoom relaxes the floor but never
  // retroactively moves an already-clamped camera. Got this backwards
  // here even after fixing the identical bug in the dual-pane effect
  // above. Guarded per-slot so it only ever runs once per map (a later
  // re-render with the same referenceMinZoom shouldn't yank the camera
  // back after the user has already zoomed/panned). Reported live,
  // 2026-10-12 ("it is not working... check it for yourself").
  useEffect(() => {
    if (referenceMinZoom === null) return;
    (Object.keys(mapRefs.current) as SlotId[]).forEach((slot) => {
      const map = mapRefs.current[slot];
      if (!map || minZoomAppliedRef.current[slot]) return;
      minZoomAppliedRef.current[slot] = true;
      map.setMinZoom(referenceMinZoom);
      // Skip the default floor-zoom camera when a district is already
      // focused elsewhere -- the dual-pane sync effect above takes over
      // camera placement for that case instead, matching the already-
      // focused view rather than snapping this newly-mounted map out to
      // the overview scale. Per project owner report, 2026-10-16.
      if (selectedIdRef.current) return;
      map.setZoom(referenceMinZoom);
    });
  }, [referenceMinZoom, mapReadyVersion]);

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
        setPriorities({ property: valueProperty, rows: rankInvestmentPriorities(data, valueProperty) });
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
        priorityRows={priorities?.property === valueProperty ? priorities.rows : null}
        highlightPriorities={highlightPriorities && !!sportType}
        onHighlightPrioritiesChange={(enabled) => {
          setHighlightPriorities(enabled);
          if (enabled) setView("map");
        }}
        onSportTypeChange={setSportType}
        demographicCategory={demographicCategory}
        onDemographicCategoryChange={setDemographicCategory}
        view={view}
        onViewChange={setView}
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
          // Matches the foldable catalog's own borders (its outer
          // borderRight and the divider between its two sections), not an
          // unrelated stark white. Per project owner instruction,
          // 2026-10-08 ("the same as the borders for the demographic
          // tab").
          border: "1px solid #333",
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
            <MenuArrow direction="left" />
            Hide Menu
          </>
        ) : (
          <>
            Show Menu
            <MenuArrow direction="right" />
          </>
        )}
      </button>

      <div ref={contentAreaRef} style={{ flex: 1, height: "100%", position: "relative" }}>
        {/* display:none (not unmounted) while viewing charts -- the maps
            stay alive underneath so switching back to the map view doesn't
            re-fetch/re-fit everything from scratch. Per project owner
            instruction, 2026-10-14 ("click on the map [icon] to go to the
            normal map view"). */}
        <div style={{ display: view === "map" ? "flex" : "none", height: "100%" }}>
          <div style={{ flex: 1, height: "100%", position: "relative" }}>
            <InteractiveMap
              slot="travel-time"
              geojsonUrl={withBasePath("/data/burden_index.geojson")}
              boundsUrl={withBasePath("/data/demographics.geojson")}
              valueProperty={valueProperty}
              binEdges={sportType ? burdenBinEdges : null}
              colorMode="positiveQuantile"
              baseOnly={!sportType}
              highlightPriorities={highlightPriorities && !!sportType}
              onMapReady={handleMapReady}
              onFeatureIdsReady={handleFeatureIdsReady}
              onHover={handleHover}
              onNtaClick={handleNtaClick}
            />
            {sportType && burdenBinEdges && (
              <MapLegend title={`${sportLabel} Access Burden (Percentile)`} colors={BURDEN_BIN_COLORS} labels={BURDEN_BAND_LABELS} />
            )}
            {tooltip?.slot === "travel-time" && canShowStats(tooltip.slot, tooltip.ntaCode) && <NtaTooltip info={tooltip} />}
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
              {tooltip?.slot === "demographics" && canShowStats(tooltip.slot, tooltip.ntaCode) && <NtaTooltip info={tooltip} />}
            </div>
          )}
        </div>
        {view === "charts" && <DashboardView sportType={sportType} />}
      </div>
    </div>
  );
}
