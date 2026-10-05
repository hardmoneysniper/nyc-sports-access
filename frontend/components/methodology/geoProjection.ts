// Small hand-rolled geometry helpers for the Travel Time tab's illustrative
// map -- no mapping library needed for a single small, static neighborhood
// view. Per project owner instruction, 2026-10-05.
export type LngLat = [number, number];

/** Area-weighted centroid of a polygon's exterior ring (first ring). */
export function polygonCentroid(ring: LngLat[]): LngLat {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) {
    const n = ring.length || 1;
    const sum = ring.reduce<[number, number]>((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
    return [sum[0] / n, sum[1] / n];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

/**
 * Exterior ring regardless of whether the feature is a Polygon or a
 * MultiPolygon (NYC facility footprints are a mix of both -- one of
 * Elmhurst's own soccer facilities is a MultiPolygon). Blindly reading
 * `coordinates[0]` on a MultiPolygon returns an array of RINGS, not a
 * ring of positions -- centroid math on that silently produces NaN,
 * which then poisons the whole map's bounds/projector and makes
 * everything invisible. Picks the largest sub-polygon (by vertex count)
 * for a MultiPolygon. Reported live, 2026-10-05: "nothing on the travel
 * time is showing."
 */
export function exteriorRingOf(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): LngLat[] {
  if (geometry.type === "Polygon") return geometry.coordinates[0] as LngLat[];
  const rings = geometry.coordinates.map((poly) => poly[0] as LngLat[]);
  return rings.reduce((a, b) => (b.length > a.length ? b : a));
}

export type Bounds = { minLng: number; maxLng: number; minLat: number; maxLat: number };

export function boundsOf(points: LngLat[]): Bounds {
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return { minLng: Math.min(...lngs), maxLng: Math.max(...lngs), minLat: Math.min(...lats), maxLat: Math.max(...lats) };
}

/**
 * Local equirectangular-ish projector: corrects longitude spacing by
 * cos(latitude) so the small area doesn't look stretched, preserves
 * aspect ratio, centers `centerBounds` (the NTA itself) at the canvas
 * center, and sizes the scale so all of `extentBounds` (which may be
 * larger -- e.g. including an out-of-neighborhood facility) stays inside
 * the canvas.
 *
 * Scale is computed from the *largest distance from the center to any
 * extent edge*, not from the extent's own (possibly off-center) span --
 * fitting the extent's own bounding box while centering on a DIFFERENT
 * point (the NTA's center) doesn't actually guarantee everything fits:
 * if a facility sits well to one side of the neighborhood, the opposite
 * side of the canvas has unused room while that facility gets pushed past
 * the edge and clipped. Reported live, 2026-10-05 ("the square block
 * indicating a soccer field... disappeared or was out of the frame").
 */
export function makeCenteredProjector(
  centerBounds: Bounds,
  extentBounds: Bounds,
  width: number,
  height: number,
  padding = 24
) {
  const centerLng = (centerBounds.minLng + centerBounds.maxLng) / 2;
  const centerLat = (centerBounds.minLat + centerBounds.maxLat) / 2;
  const lngCorrection = Math.cos((centerLat * Math.PI) / 180);

  const halfLngSpan =
    Math.max(centerLng - extentBounds.minLng, extentBounds.maxLng - centerLng) * lngCorrection || 1;
  const halfLatSpan = Math.max(centerLat - extentBounds.minLat, extentBounds.maxLat - centerLat) || 1;

  const availW = width - padding * 2;
  const availH = height - padding * 2;
  const scale = Math.min(availW / (2 * halfLngSpan), availH / (2 * halfLatSpan));

  const cx = width / 2;
  const cy = height / 2;

  return ([lng, lat]: LngLat): [number, number] => [
    cx + (lng - centerLng) * lngCorrection * scale,
    cy - (lat - centerLat) * scale,
  ];
}
