"use client";

import { useEffect, useState } from "react";
import type { Map as MapboxMap, MapLayerMouseEvent, GeoJSONSource } from "mapbox-gl";
import { addFacilityLabels } from "@/lib/facilityLabels";
import { withBasePath } from "@/lib/basePath";
import { featureCollectionBounds } from "@/lib/geoBounds";
import { ntaCodeToFeatureId } from "@/lib/ntaId";
import { NTA_SOURCE_ID, NTA_FILL_LAYER_ID, NTA_LINE_LAYER_ID, MAPBOX_MAX_ZOOM } from "@/lib/mapboxConfig";

const SOURCE_IDS = ["detail-tracts", "detail-routes", "detail-facilities"];
const TRACT_HIT_LAYER = "detail-tract-hit";
const LAYER_IDS = [TRACT_HIT_LAYER, "detail-tract-lines", "detail-selected-tract-line", "detail-route-halo", "detail-route-lines", "detail-facility-fill", "detail-facility-lines"];

async function readData(path: string, signal: AbortSignal): Promise<GeoJSON.FeatureCollection> {
  const response = await fetch(withBasePath(`/data/${path}`), { signal });
  if (!response.ok) throw new Error("Detail data unavailable");
  return response.json();
}

export default function NtaRouteDetail({ map, ntaCode, sport }: { map: MapboxMap; ntaCode: string; sport: string }) {
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [activeModes, setActiveModes] = useState<string[]>([]);
  const [status, setStatus] = useState("Loading census-tract details…");

  useEffect(() => {
    const controller = new AbortController();
    const neighborhoodLayers = ["ntas-base-fill", NTA_FILL_LAYER_ID, NTA_LINE_LAYER_ID, "ntas-investment-priorities"];
    const previousFilters = new Map(neighborhoodLayers.filter((id) => map.getLayer(id)).map((id) => [id, map.getFilter(id)]));
    let clearLabels: (() => void) | null = null;
    let tractClick: ((event: MapLayerMouseEvent) => void) | null = null;
    const enterTract = () => { map.getCanvas().style.cursor = "pointer"; };
    const leaveTract = () => { map.getCanvas().style.cursor = ""; };
    async function load() {
      // Only these detailed exports are bundled currently. Keep unsupported
      // selections explicit instead of substituting straight-line routes.
      if (ntaCode !== "QN0401") {
        setStatus("Census-tract boundaries and routes are not available for this neighborhood yet.");
        return;
      }
      try {
        const tracts = await readData(`tracts/${ntaCode}.geojson`, controller.signal);
        if (controller.signal.aborted) return;
        for (const [id, filter] of previousFilters) {
          if (id === NTA_LINE_LAYER_ID || id === "ntas-investment-priorities") {
            map.setFilter(id, ["==", ["get", "NTA2020"], ""]);
            continue;
          }
          const selectedFilter: import("mapbox-gl").FilterSpecification = ["==", ["get", "NTA2020"], ntaCode];
          map.setFilter(id, filter ? ["all", filter, selectedFilter] : selectedFilter);
        }
        map.addSource(SOURCE_IDS[0], { type: "geojson", data: tracts });
        map.addLayer({ id: "detail-tract-lines", type: "line", source: SOURCE_IDS[0], paint: { "line-color": "#ffffff", "line-width": 1.5, "line-opacity": 1 } });
        map.addLayer({ id: "detail-selected-tract-line", type: "line", source: SOURCE_IDS[0], filter: ["==", ["get", "GEOID"], ""], paint: { "line-color": "#ffffff", "line-width": 2.5, "line-opacity": 1 } });
        map.setFeatureState({ source: NTA_SOURCE_ID, id: ntaCodeToFeatureId(ntaCode) }, { detail: true });
        if (sport !== "soccer") {
          setStatus(`${tracts.features.length} census tracts · Routes for this sport are not available yet.`);
          return;
        }
        const [routes, facilities] = await Promise.all([
          readData(`routes/${ntaCode}_soccer_weekday_evening.geojson`, controller.signal),
          readData("facilities/soccer.geojson", controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const destinationIds = new Set(routes.features.map((f) => String(f.properties?.nearest_facility_id)));
        const destinations: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: facilities.features.filter((f) => destinationIds.has(String(f.properties?.facility_id))) };
        const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
        map.addSource(SOURCE_IDS[1], { type: "geojson", data: empty });
        map.addSource(SOURCE_IDS[2], { type: "geojson", data: empty });
        map.addLayer({ id: TRACT_HIT_LAYER, type: "fill", source: SOURCE_IDS[0], paint: { "fill-color": "#ffffff", "fill-opacity": 0.01 } }, "detail-tract-lines");
        map.addLayer({ id: "detail-route-halo", type: "line", source: SOURCE_IDS[1], paint: { "line-color": "#000000", "line-width": 6, "line-opacity": 0.7 } });
        map.addLayer({ id: "detail-route-lines", type: "line", source: SOURCE_IDS[1], paint: { "line-color": ["match", ["get", "transport_mode"], "TransportMode.WALK", "#ff7f00", "TransportMode.BUS", "#38bdf8", "TransportMode.SUBWAY", "#c084fc", "#ff7f00"], "line-width": 3 } });
        map.addLayer({ id: "detail-facility-fill", type: "fill", source: SOURCE_IDS[2], paint: { "fill-color": "#5ee388", "fill-opacity": 0.6 } });
        map.addLayer({ id: "detail-facility-lines", type: "line", source: SOURCE_IDS[2], paint: { "line-color": "#5ee388", "line-width": 3 } });
        setStatus("");
        let selectedTract: string | null = null;
        tractClick = (event) => {
          const geoid = event.features?.[0]?.properties?.GEOID;
          if (!geoid) return;
          clearLabels?.();
          clearLabels = null;
          if (selectedTract === geoid) {
            selectedTract = null;
            setActiveModes([]);
            for (const id of ["ntas-base-fill", NTA_FILL_LAYER_ID]) {
              const original = previousFilters.get(id);
              const selected: import("mapbox-gl").FilterSpecification = ["==", ["get", "NTA2020"], ntaCode];
              map.setFilter(id, original ? ["all", original, selected] : selected);
            }
            (map.getSource(SOURCE_IDS[1]) as GeoJSONSource).setData(empty);
            (map.getSource(SOURCE_IDS[2]) as GeoJSONSource).setData(empty);
            map.setPaintProperty(TRACT_HIT_LAYER, "fill-color", "#ffffff");
            map.setPaintProperty(TRACT_HIT_LAYER, "fill-opacity", 0.01);
            map.setPaintProperty("detail-tract-lines", "line-color", "#ffffff");
            map.setFilter("detail-selected-tract-line", ["==", ["get", "GEOID"], ""]);
            setStatus("");
            map.fitBounds(featureCollectionBounds(tracts), { padding: 40, duration: 900, maxZoom: MAPBOX_MAX_ZOOM });
            return;
          }
          selectedTract = geoid;
          // Remove the underlying NTA fills too, so unselected tracts
          // reveal the basemap rather than the neighborhood tint.
          for (const id of ["ntas-base-fill", NTA_FILL_LAYER_ID]) {
            map.setFilter(id, ["==", ["get", "NTA2020"], ""]);
          }
          const selectedRoutes: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: routes.features.filter((f) => f.properties?.GEOID === geoid) };
          setTotalMinutes(selectedRoutes.features.reduce((sum, feature) => sum + Number(feature.properties?.travel_time ?? 0) + Number(feature.properties?.wait_time ?? 0), 0) / 60);
          setActiveModes([...new Set(selectedRoutes.features.map((feature) => String(feature.properties?.transport_mode)))]);
          const ids = new Set(selectedRoutes.features.map((f) => String(f.properties?.nearest_facility_id)));
          const selectedFacilities: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: destinations.features.filter((f) => ids.has(String(f.properties?.facility_id))) };
          (map.getSource(SOURCE_IDS[1]) as GeoJSONSource).setData(selectedRoutes);
          (map.getSource(SOURCE_IDS[2]) as GeoJSONSource).setData(selectedFacilities);
          clearLabels = addFacilityLabels(map, selectedFacilities, selectedRoutes);
          map.setPaintProperty(TRACT_HIT_LAYER, "fill-color", ["case", ["==", ["get", "GEOID"], geoid], "#607d94", "#555555"]);
          map.setPaintProperty(TRACT_HIT_LAYER, "fill-opacity", ["case", ["==", ["get", "GEOID"], geoid], 0.3, 0]);
          map.setPaintProperty("detail-tract-lines", "line-color", "#bbbbbb");
          map.setFilter("detail-selected-tract-line", ["==", ["get", "GEOID"], geoid]);
          if (!selectedRoutes.features.length) {
            setStatus(`Census tract ${geoid} · No route available.`);
            return;
          }
          const detailBounds = featureCollectionBounds({ type: "FeatureCollection", features: [...tracts.features.filter((f) => f.properties?.GEOID === geoid), ...selectedRoutes.features, ...selectedFacilities.features] });
          setStatus("");
          map.fitBounds(detailBounds, { padding: 80, duration: 900, maxZoom: MAPBOX_MAX_ZOOM });
        };
        map.on("click", TRACT_HIT_LAYER, tractClick);
        map.on("mouseenter", TRACT_HIT_LAYER, enterTract);
        map.on("mouseleave", TRACT_HIT_LAYER, leaveTract);
      } catch {
        if (!controller.signal.aborted) setStatus("Detailed map data could not be loaded. Reselect the neighborhood to retry.");
      }
    }
    void load();
    return () => {
      controller.abort();
      clearLabels?.();
      if (tractClick) map.off("click", TRACT_HIT_LAYER, tractClick);
      map.off("mouseenter", TRACT_HIT_LAYER, enterTract);
      map.off("mouseleave", TRACT_HIT_LAYER, leaveTract);
      if (!map.getStyle()) return;
      for (const [id, filter] of previousFilters) if (map.getLayer(id)) map.setFilter(id, filter ?? null);
      for (const id of [...LAYER_IDS].reverse()) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of SOURCE_IDS) if (map.getSource(id)) map.removeSource(id);
      if (map.getSource(NTA_SOURCE_ID)) map.setFeatureState({ source: NTA_SOURCE_ID, id: ntaCodeToFeatureId(ntaCode) }, { detail: false });
    };
  }, [map, ntaCode, sport]);

  if (!status && activeModes.length === 0) return null;
  if (!status) return (
    <div aria-label="Route transportation modes" style={{ position: "absolute", top: 68, right: 10, zIndex: 1000, width: "max-content", maxWidth: "calc(100% - 20px)", padding: "12px 16px", background: "#000", border: "1px solid #444", color: "#fff", fontSize: 12 }}>
      <div style={{ marginBottom: 12, fontWeight: 600 }}>Total travel time: {totalMinutes.toFixed(1)} min</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {[{ mode: "TransportMode.WALK", label: "Walk", color: "#ff7f00" }, { mode: "TransportMode.BUS", label: "Bus", color: "#38bdf8" }, { mode: "TransportMode.SUBWAY", label: "Subway", color: "#c084fc" }].filter((item) => activeModes.includes(item.mode)).map((item) => (
        <span key={item.mode} style={{ display: "flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 18, height: 3, background: item.color }} />{item.label}</span>
      ))}
      </div>
    </div>
  );

  return (
    <div role="status" style={{ position: "absolute", bottom: 32, right: 12, maxWidth: "min(360px, calc(100% - 70px))", padding: "12px 14px", background: "#000e", border: "1px solid #444", color: "#fff", fontSize: 12, lineHeight: 1.5, zIndex: 1000 }}>
      <div>{status}</div>
    </div>
  );
}
