"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { colorForValue, NO_DATA_COLOR } from "@/lib/colorScale";
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
  onMapReady?: (slot: SlotId, map: MapboxMap | null) => void;
  onInitialViewReady?: (slot: SlotId, view: MapView) => void;
  onFeatureIdsReady?: (slot: SlotId, ntaCodes: string[]) => void;
  onHover?: (slot: SlotId, info: HoverInfo | null) => void;
  onNtaClick?: (slot: SlotId, info: ClickInfo) => void;
  baseOnly?: boolean;
};

function colorizeGeojson(
  data: GeoJSON.FeatureCollection,
  valueProperty: string | null,
  binEdges: number[] | null
): GeoJSON.FeatureCollection {
  return {
    ...data,
    features: data.features.map((f) => {
      const value = valueProperty && binEdges ? (f.properties?.[valueProperty] as number | null | undefined) : null;
      const fillColor = binEdges ? colorForValue(value, binEdges) : NO_DATA_COLOR;
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
  onMapReady,
  onInitialViewReady,
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
  const coloringRef = useRef({ valueProperty, binEdges });
  coloringRef.current = { valueProperty, binEdges };
  const callbacksRef = useRef({ onMapReady, onInitialViewReady, onFeatureIdsReady, onHover, onNtaClick });
  callbacksRef.current = { onMapReady, onInitialViewReady, onFeatureIdsReady, onHover, onNtaClick };

  useEffect(() => {
    if (baseOnly || !containerRef.current) return;
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
    callbacksRef.current.onMapReady?.(slot, map);

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    const applyData = () => {
      const raw = rawGeojsonRef.current;
      if (!raw) return;
      const { valueProperty: vp, binEdges: be } = coloringRef.current;
      const colored = colorizeGeojson(raw, vp, be);
      const source = map.getSource(NTA_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) {
        source.setData(colored as GeoJSON.GeoJSON);
        return;
      }

      map.addSource(NTA_SOURCE_ID, { type: "geojson", data: colored as GeoJSON.GeoJSON });
      map.addLayer({
        id: NTA_FILL_LAYER_ID,
        type: "fill",
        source: NTA_SOURCE_ID,
        paint: {
          "fill-color": ["get", "_fillColor"],
          // Selecting an NTA sets every OTHER feature's "dimmed"
          // feature-state (see app/explore/page.tsx's setDimming) so it
          // reads at DIMMED_FILL_OPACITY while the selected one stays at
          // SELECTED_FILL_OPACITY. No transition on this property --
          // fill-opacity-transition was tried here and reported not
          // working in practice, 2026-09-27, so the change is instant.
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            SELECTED_FILL_OPACITY,
            ["boolean", ["feature-state", "dimmed"], false],
            DIMMED_FILL_OPACITY,
            DEFAULT_FILL_OPACITY,
          ],
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
        const view: MapView = { center: map.getCenter().toArray() as [number, number], zoom: map.getZoom() };
        map.setMinZoom(view.zoom);
        firstFitDoneRef.current = true;
        callbacksRef.current.onInitialViewReady?.(slot, view);
      }

      map.on("mousemove", NTA_FILL_LAYER_ID, (e) => {
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
    // Created once per mount -- geojsonUrl/slot/baseOnly are fixed for the
    // lifetime of a given InteractiveMap instance in this app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseOnly]);

  // Recolor in place when the demographic category / sport type changes,
  // without re-fetching or re-fitting.
  useEffect(() => {
    if (baseOnly || !layersReadyRef.current) return;
    const map = mapRef.current;
    const raw = rawGeojsonRef.current;
    if (!map || !raw) return;
    const source = map.getSource(NTA_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(colorizeGeojson(raw, valueProperty, binEdges) as GeoJSON.GeoJSON);
  }, [valueProperty, binEdges, baseOnly]);

  if (baseOnly) {
    return <BaseOnlyMap />;
  }

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}

// Renders just the basemap -- no choropleth data, no click handling. Used
// for the "0 selected" state.
function BaseOnlyMap() {
  const containerRef = useRef<HTMLDivElement>(null);
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
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);
    return () => {
      resizeObserver.disconnect();
      map.remove();
    };
  }, []);
  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}
