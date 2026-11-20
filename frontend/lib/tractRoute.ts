/** Pick one complete itinerary, including for sports combining raw categories. */
export function selectTractRoute(routes: GeoJSON.FeatureCollection, geoid: string): GeoJSON.FeatureCollection {
  const options = new Map<string, GeoJSON.Feature[]>();
  for (const feature of routes.features) {
    const p = feature.properties;
    if (String(p?.GEOID) !== String(geoid)) continue;
    const key = JSON.stringify([p?.sport_type, p?.nearest_facility_id, p?.option]);
    const segments = options.get(key) ?? [];
    segments.push(feature);
    options.set(key, segments);
  }
  let best: GeoJSON.Feature[] = [];
  let bestSeconds = Infinity;
  for (const segments of options.values()) {
    const seconds = segments.reduce((sum, f) => sum + Number(f.properties?.travel_time ?? 0) + Number(f.properties?.wait_time ?? 0), 0);
    if (Number.isFinite(seconds) && seconds < bestSeconds) { best = segments; bestSeconds = seconds; }
  }
  return { type: "FeatureCollection", features: best };
}
