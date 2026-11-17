import type { Map as MapboxMap } from "mapbox-gl";
import { geometryBounds } from "./geoBounds";

// Screen-space placement keeps labels off the selected route as the map moves.
export function addFacilityLabels(map: MapboxMap, facilities: GeoJSON.FeatureCollection, routes: GeoJSON.FeatureCollection) {
  const labels = facilities.features.map((feature) => {
    const element = document.createElement("div");
    element.textContent = String(feature.properties?.name ?? `Facility ${feature.properties?.facility_id}`);
    Object.assign(element.style, { position: "absolute", pointerEvents: "none", color: "#5ee388", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap", textShadow: "-1px -1px 2px #000, 1px 1px 2px #000, 0 0 4px #000", zIndex: "2" });
    map.getContainer().appendChild(element);
    return { element, bounds: geometryBounds(feature.geometry) };
  });
  const place = () => {
    const segments: { x: number; y: number }[][] = [];
    for (const feature of routes.features) {
      const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.type === "MultiLineString" ? feature.geometry.coordinates : [];
      for (const line of lines) for (let i = 1; i < line.length; i++) {
        segments.push([map.project(line[i - 1] as [number, number]), map.project(line[i] as [number, number])]);
      }
    }
    const container = map.getContainer();
    for (const { element, bounds } of labels) {
      const a = map.project(bounds[0]);
      const b = map.project(bounds[1]);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const w = element.offsetWidth, h = element.offsetHeight;
      const candidates = [];
      for (const gap of [16, 32, 56, 88]) candidates.push(
        [Math.max(a.x, b.x) + gap, cy - h / 2], [Math.min(a.x, b.x) - gap - w, cy - h / 2],
        [cx - w / 2, Math.min(a.y, b.y) - gap - h], [cx - w / 2, Math.max(a.y, b.y) + gap],
      );
      const position = candidates.find(([x, y]) => {
        if (x < 8 || y < 8 || x + w > container.clientWidth - 8 || y + h > container.clientHeight - 8) return false;
        // Conservative segment bounding-box intersection adds breathing room
        // around the orange line, including its black casing.
        return !segments.some(([p, q]) => Math.max(p.x, q.x) >= x - 7 && Math.min(p.x, q.x) <= x + w + 7 && Math.max(p.y, q.y) >= y - 7 && Math.min(p.y, q.y) <= y + h + 7);
      });
      element.style.visibility = position ? "visible" : "hidden";
      if (position) { element.style.left = `${position[0]}px`; element.style.top = `${position[1]}px`; }
    }
  };
  map.on("move", place);
  map.on("resize", place);
  place();
  return () => { map.off("move", place); map.off("resize", place); labels.forEach(({ element }) => element.remove()); };
}
