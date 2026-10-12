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

// Mapbox's own fitBounds/cameraForBounds zoom math (bearing/pitch 0 case),
// reimplemented as pure, synchronous arithmetic -- no live map instance
// needed. A headless, hidden mapboxgl.Map was tried first to get this
// number (exact, but depends on the browser actually rendering/loading a
// style for a visibility:hidden, non-interactive canvas, and on React
// effect timing lining up before the real map's own default view is
// shown) and was still landing late or not at all. This has no such
// dependency: given a bounds box and a target container size, it's just
// Web Mercator projection math, standard tile size (512px), and
// scale=2^zoom -- the exact formula Mapbox GL itself uses internally.
// Reported live, 2026-10-12 ("it still does not start at the floor scale
// right now").
const MERCATOR_TILE_SIZE = 512;

function mercatorY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2;
}

export function zoomToFitBounds(
  bounds: [[number, number], [number, number]],
  width: number,
  height: number,
  padding: number,
  maxZoom: number
): number {
  const [[west, south], [east, north]] = bounds;
  const dx = Math.abs((east + 180) / 360 - (west + 180) / 360);
  const dy = Math.abs(mercatorY(south) - mercatorY(north));
  const availW = Math.max(1, width - padding * 2);
  const availH = Math.max(1, height - padding * 2);
  const zoom = Math.min(Math.log2(availW / (dx * MERCATOR_TILE_SIZE)), Math.log2(availH / (dy * MERCATOR_TILE_SIZE)));
  return Math.min(zoom, maxZoom);
}
