"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { colorForValue, colorForBurdenValue, NO_DATA_COLOR } from "@/lib/colorScale";
import {
  MAPBOX_TOKEN,
  MAPBOX_STYLE,
  MAPBOX_MAX_ZOOM,
  NTA_SOURCE_ID,
  NTA_FILL_LAYER_ID,
  NTA_LINE_LAYER_ID,
  HOVER_SELECTED_LINE_WIDTH,
  DEFAULT_LINE_WIDTH,
  LINE_WIDTH_TRANSITION_MS,
  DEFAULT_FILL_OPACITY,
  SELECTED_FILL_OPACITY,
  DIMMED_FILL_OPACITY,
} from "@/lib/mapboxConfig";
import { featureCollectionBounds, geometryBounds } from "@/lib/geoBounds";
import { ntaCodeToFeatureId } from "@/lib/ntaId";

if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

const NYC_CENTER: [number, number] = [-73.94, 40.7128]; // mapbox-gl uses [lng, lat]
const NYC_ZOOM = 10;

const NTA_BASE_FILL_LAYER_ID = "ntas-base-fill";
// Less than the border's full opacity (the line layer's "line-color" has no
// opacity set, so it's fully opaque) -- an "almost transparent" fill under
// the blank/no-selection state, not a choropleth. Stays mounted underneath
// the colored layer at all times (never added/removed), so toggling a
// selection on fades the colored layer in over a base that was already
// there instead of swapping map instances. Per project owner instruction,
// 2026-10-05 ("make the blank map a base layer... toggling is just
// toggling the overlaying layers").
const BASE_FILL_OPACITY = 0.08;
const FILL_OPACITY_TRANSITION_MS = 400;

export type SlotId = "demographics" | "travel-time";
export type MapView = { center: [number, number]; zoom: number };
// properties carries the feature's raw data (NTAName, total_population,
// every pct_*/travel_time_* column, etc.) -- the parent formats the
// actual tooltip lines from it, since it's the one that knows which
// demographic category / sport type is currently selected.
export type HoverInfo = { ntaCode: string; properties: Record<string, unknown>; x: number; y: number };
export type ClickInfo = {
  ntaCode: string;
  properties: Record<string, unknown>;
  bounds: [[number, number], [number, number]];
  x: number;
  y: number;
};

type NtaProperties = { NTA2020: string; NTAName: string; _fillColor: string; _noData: boolean; [key: string]: unknown };

type Props = {
  slot: SlotId;
  geojsonUrl: string;
  valueProperty: string | null;
  binEdges: number[] | null;
  // "positiveQuantile" is the burden-index map's coloring: values <= 0 get
  // a single flat "no excess burden" color instead of joining the 5-color
  // gradient, which only spans the positive (underserved) values. Demo-
  // graphics stays on the default "quantile" mode, where 0% is a normal
  // value, not a special case. Per project owner instruction, 2026-09-29.
  colorMode?: "quantile" | "positiveQuantile";
  onMapReady?: (slot: SlotId, map: MapboxMap | null) => void;
  onFeatureIdsReady?: (slot: SlotId, ntaCodes: string[]) => void;
  onHover?: (slot: SlotId, info: HoverInfo | null) => void;
  onNtaClick?: (slot: SlotId, info: ClickInfo) => void;
  // True when there's no selection to color by yet -- the colored overlay
  // fades to 0 opacity (revealing the base layer) and hover/click are
  // disabled, but the map/source/layers themselves stay mounted. Per
  // project owner instruction, 2026-10-05.
  baseOnly?: boolean;
};

function colorizeGeojson(
  data: GeoJSON.FeatureCollection,
  valueProperty: string | null,
  binEdges: number[] | null,
  colorMode: "quantile" | "positiveQuantile"
): GeoJSON.FeatureCollection {
  return {
    ...data,
    features: data.features.map((f) => {
      const value = valueProperty && binEdges ? (f.properties?.[valueProperty] as number | null | undefined) : null;
      const fillColor = !binEdges
        ? NO_DATA_COLOR
        : colorMode === "positiveQuantile"
          ? colorForBurdenValue(value, binEdges)
          : colorForValue(value, binEdges);
      const ntaCode = f.properties?.NTA2020 as string;
      // Drives both the gray "no data" fill AND (per project owner
      // instruction, 2026-09-27) whether the NTA is clickable at all --
      // see the click handler below.
      const isNoData = value === null || value === undefined || (typeof value === "number" && Number.isNaN(value));
      return {
        ...f,
        id: ntaCodeToFeatureId(ntaCode),
        properties: { ...f.properties, _fillColor: fillColor, _noData: isNoData },
      };
    }),
  };
}

// The colored layer's base (unselected/undimmed) opacity is 0 whenever
// there's no selection yet, 0 -> DEFAULT_FILL_OPACITY is what actually
// animates (via fill-opacity-transition below) when a selection is made.
// Selected/dimmed feature-states still win over that base value exactly
// like before.
function fillOpacityExpression(hasData: boolean): mapboxgl.Expression {
  return [
    "case",
    ["boolean", ["feature-state", "selected"], false],
    SELECTED_FILL_OPACITY,
    ["boolean", ["feature-state", "dimmed"], false],
    DIMMED_FILL_OPACITY,
    hasData ? DEFAULT_FILL_OPACITY : 0,
  ];
}

// NTA-click -> tract-detail view was deferred 2026-09-26, then rebuilt on
// Mapbox GL 2026-09-27 (per project owner instruction -- Mapbox's
// continuously-firing "move" event during ANY camera change, including
// flyTo/fitBounds, makes cross-map synchronized magnify/shrink far more
// direct than Leaflet's CSS-transition zoom allowed). This component only
// creates the map, colors the choropleth, and reports raw
// hover/click/ready events up to the parent -- ALL cross-map coordination
// (feature-state mirroring, camera sync, magnify/shrink, the single
// shared tooltip) lives in app/explore/page.tsx, since it needs both map
// instances at once.
export default function InteractiveMap({
  slot,
  geojsonUrl,
  valueProperty,
  binEdges,
  colorMode = "quantile",
  onMapReady,
  onFeatureIdsReady,
  onHover,
  onNtaClick,
  baseOnly,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const rawGeojsonRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const firstFitDoneRef = useRef(false);
  // True once the source+layers have been added at least once. The recolor
  // effect below used to gate on map.isStyleLoaded(), falling back to
  // map.once("load", ...) when it returned false -- but "load" only ever
  // fires once per map instance, and isStyleLoaded() can still read false
  // for a moment right after a setData() call. That combination silently
  // dropped every recolor that happened to land in that window (reported
  // live, 2026-09-27: selecting a sport type showed no color at all).
  // Once the layers exist, setData() is always safe to call directly, so
  // this ref replaces that check entirely for the recolor effect.
  const layersReadyRef = useRef(false);

  // Always-current refs so effects/event handlers set up once at mount
  // (map creation, layer wiring) never read stale closed-over props --
  // valueProperty/binEdges/callbacks can all change after those run once.
  // Updated in an effect (post-render), not during render itself, per
  // react-hooks/refs.
  const coloringRef = useRef({ valueProperty, binEdges, colorMode, baseOnly });
  useEffect(() => {
    coloringRef.current = { valueProperty, binEdges, colorMode, baseOnly };
  }, [valueProperty, binEdges, colorMode, baseOnly]);

  const callbacksRef = useRef({ onMapReady, onFeatureIdsReady, onHover, onNtaClick });
  useEffect(() => {
    callbacksRef.current = { onMapReady, onFeatureIdsReady, onHover, onNtaClick };
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      center: NYC_CENTER,
      zoom: NYC_ZOOM,
      maxZoom: MAPBOX_MAX_ZOOM,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-left");
    mapRef.current = map;
    // onMapReady is reported to the parent only after this map's own
    // initial fitBounds has run (see applyData below) -- reporting it
    // here, immediately at construction, let the parent's camera-sync
    // effect read this map's center/zoom before fitBounds had set them,
    // relaying its still-default NYC_CENTER/NYC_ZOOM onto the OTHER
    // (already correctly fitted) map and clobbering it. Reported live,
    // 2026-09-29: the two maps started at different scales.

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    const applyData = () => {
      const raw = rawGeojsonRef.current;
      if (!raw) return;
      const { valueProperty: vp, binEdges: be, colorMode: cm } = coloringRef.current;
      const colored = colorizeGeojson(raw, vp, be, cm);
      const source = map.getSource(NTA_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) {
        source.setData(colored as GeoJSON.GeoJSON);
        return;
      }

      map.addSource(NTA_SOURCE_ID, { type: "geojson", data: colored as GeoJSON.GeoJSON });

      // Faint, always-on base fill -- stays mounted under the colored
      // layer in every state, so there's no map/layer swap to flash
      // between "blank" and "colored", just the layer above it fading in.
      map.addLayer({
        id: NTA_BASE_FILL_LAYER_ID,
        type: "fill",
        source: NTA_SOURCE_ID,
        paint: { "fill-color": "#ffffff", "fill-opacity": BASE_FILL_OPACITY },
      });

      map.addLayer({
        id: NTA_FILL_LAYER_ID,
        type: "fill",
        source: NTA_SOURCE_ID,
        paint: {
          "fill-color": ["get", "_fillColor"],
          "fill-opacity": fillOpacityExpression(!!(vp && be)),
          // Only animates the BASE value (blank <-> colored, set via
          // setPaintProperty in the recolor effect below) -- the
          // selected/dimmed feature-state cases switch instantly, same as
          // before. Per project owner instruction, 2026-09-27 (instant
          // dim/select) and 2026-10-05 (smooth blank<->colored fade).
          "fill-opacity-transition": { duration: FILL_OPACITY_TRANSITION_MS },
        },
      });
      map.addLayer({
        id: NTA_LINE_LAYER_ID,
        type: "line",
        source: NTA_SOURCE_ID,
        paint: {
          "line-color": "#ffffff",
          "line-width": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            HOVER_SELECTED_LINE_WIDTH,
            ["boolean", ["feature-state", "selected"], false],
            HOVER_SELECTED_LINE_WIDTH,
            DEFAULT_LINE_WIDTH,
          ],
          "line-width-transition": { duration: LINE_WIDTH_TRANSITION_MS },
        },
      });
      layersReadyRef.current = true;

      if (!firstFitDoneRef.current) {
        const bounds = featureCollectionBounds(colored);
        map.fitBounds(bounds, { padding: 10, duration: 0, maxZoom: MAPBOX_MAX_ZOOM });
        map.setMinZoom(map.getZoom());
        firstFitDoneRef.current = true;
        callbacksRef.current.onMapReady?.(slot, map);
      }

      map.on("mousemove", NTA_FILL_LAYER_ID, (e) => {
        const { valueProperty: curVp, binEdges: curBe } = coloringRef.current;
        if (!curVp || !curBe) {
          // Nothing selected -- no tooltip, no pointer cursor to promise a
          // click will do anything.
          map.getCanvas().style.cursor = "";
          return;
        }
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as NtaProperties;
        // No-data NTAs are unclickable but still hoverable -- the tooltip
        // is what tells the user there's nothing there, so the cursor
        // shouldn't promise a click will do anything. Per project owner
        // instruction, 2026-09-27.
        map.getCanvas().style.cursor = props._noData ? "" : "pointer";
        const rect = containerRef.current!.getBoundingClientRect();
        callbacksRef.current.onHover?.(slot, {
          ntaCode: props.NTA2020,
          properties: props,
          x: e.originalEvent.clientX - rect.left,
          y: e.originalEvent.clientY - rect.top,
        });
      });

      map.on("mouseleave", NTA_FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
        callbacksRef.current.onHover?.(slot, null);
      });

      map.on("click", NTA_FILL_LAYER_ID, (e) => {
        const { valueProperty: curVp, binEdges: curBe } = coloringRef.current;
        if (!curVp || !curBe) return;
        const feature = e.features?.[0];
        if (!feature?.geometry) return;
        const props = feature.properties as NtaProperties;
        if (props._noData) return;
        const rect = containerRef.current!.getBoundingClientRect();
        callbacksRef.current.onNtaClick?.(slot, {
          ntaCode: props.NTA2020,
          properties: props,
          bounds: geometryBounds(feature.geometry),
          x: e.originalEvent.clientX - rect.left,
          y: e.originalEvent.clientY - rect.top,
        });
      });
    };

    let cancelled = false;
    fetch(geojsonUrl)
      .then((res) => res.json())
      .then((data: GeoJSON.FeatureCollection) => {
        if (cancelled) return;
        rawGeojsonRef.current = data;
        callbacksRef.current.onFeatureIdsReady?.(
          slot,
          data.features.map((f) => f.properties?.NTA2020 as string)
        );
        if (map.isStyleLoaded()) applyData();
        else map.once("load", applyData);
      });

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      callbacksRef.current.onMapReady?.(slot, null);
      map.remove();
      mapRef.current = null;
    };
    // Created once per mount -- geojsonUrl/slot are fixed for the lifetime
    // of a given InteractiveMap instance in this app. baseOnly/
    // valueProperty/binEdges/colorMode are read from coloringRef (kept
    // current by the effect above), not from this effect's own closure, so
    // they're intentionally excluded here too -- the map/layers are
    // created once and recolored/faded in place, never recreated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recolor (and fade the colored layer in/out) in place when the
  // demographic category / sport type changes, without re-fetching,
  // re-fitting, or recreating the map.
  useEffect(() => {
    if (!layersReadyRef.current) return;
    const map = mapRef.current;
    const raw = rawGeojsonRef.current;
    if (!map || !raw) return;
    const source = map.getSource(NTA_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(colorizeGeojson(raw, valueProperty, binEdges, colorMode) as GeoJSON.GeoJSON);
    map.setPaintProperty(NTA_FILL_LAYER_ID, "fill-opacity", fillOpacityExpression(!!(valueProperty && binEdges)));
  }, [valueProperty, binEdges, colorMode]);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}
