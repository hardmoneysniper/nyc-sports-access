// Minimal bbox helper so we don't need a turf dependency just to compute
// bounds for Polygon/MultiPolygon features (Mapbox's fitBounds wants
// [[west, south], [east, north]]).
export function geometryBounds(geometry: GeoJSON.Geometry): [[number, number], [number, number]] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visit = (coords: unknown): void => {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      const [lng, lat] = coords as [number, number];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    if (Array.isArray(coords)) {
      coords.forEach(visit);
    }
  };

  visit((geometry as { coordinates: unknown }).coordinates);
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export function featureCollectionBounds(fc: GeoJSON.FeatureCollection): [[number, number], [number, number]] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const feature of fc.features) {
    if (!feature.geometry) continue;
    const [[lo1, la1], [lo2, la2]] = geometryBounds(feature.geometry);
    if (lo1 < minLng) minLng = lo1;
    if (lo2 > maxLng) maxLng = lo2;
    if (la1 < minLat) minLat = la1;
    if (la2 > maxLat) maxLat = la2;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
