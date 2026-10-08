"""Pre-rasterize the methodology page's Elmhurst road-network backdrop to a
static PNG, replacing the live ~9,000-segment SVG <path> it used to render
every scene with. The road network never changes across scenes or page
state -- it's purely decorative, real OSM street geometry drawn once behind
everything else (see scripts/extract_elmhurst_roads.py) -- so re-rasterizing
it as vector SVG on every resize (e.g. the page's own menu-collapse
animation, which continuously resizes this box for ~300ms) was pure waste.
A raster image resizes via cheap GPU bitmap scaling instead. Per project
owner instruction, 2026-10-08 ("is it possible to use a png instead... the
road network does not change across all frames").

Replicates frontend/components/methodology/geoProjection.ts's exact
projection math (same centerBounds/extentBounds/makeCenteredProjector
logic as TravelTimeTab.tsx) so the baked image lines up pixel-for-pixel
with the live tract/route/facility SVG overlays drawn on top of it. Must be
re-run if MAP_W/MAP_H/padding in TravelTimeTab.tsx ever change, or if the
underlying tracts/facilities/routes/roads data files are regenerated.
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

DATA_DIR = Path("frontend/public/data")
OUT_PATH = Path("frontend/public/imgs/elmhurst_roads_backdrop.png")

ELMHURST_ID = "QN0401"
# Must match MAP_W/MAP_H/the padding argument to makeCenteredProjector in
# frontend/components/methodology/TravelTimeTab.tsx.
MAP_W, MAP_H = 640, 360
PADDING = 30
SUPERSAMPLE = 4
STROKE_WIDTH = 1.6
STROKE_COLOR = (0x23, 0x23, 0x23, 255)


def exterior_ring_of(geometry: dict) -> list[list[float]]:
    if geometry["type"] == "Polygon":
        return geometry["coordinates"][0]
    rings = [poly[0] for poly in geometry["coordinates"]]
    return max(rings, key=len)


def polygon_centroid(ring: list[list[float]]) -> tuple[float, float]:
    area = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i]
        x1, y1 = ring[i + 1]
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    area *= 0.5
    if abs(area) < 1e-12:
        n = len(ring) or 1
        sx = sum(p[0] for p in ring)
        sy = sum(p[1] for p in ring)
        return (sx / n, sy / n)
    return (cx / (6 * area), cy / (6 * area))


def bounds_of(points: list[tuple[float, float]]) -> dict:
    lngs = [p[0] for p in points]
    lats = [p[1] for p in points]
    return {"minLng": min(lngs), "maxLng": max(lngs), "minLat": min(lats), "maxLat": max(lats)}


def make_centered_projector(center_bounds: dict, extent_bounds: dict, width: int, height: int, padding: int):
    center_lng = (center_bounds["minLng"] + center_bounds["maxLng"]) / 2
    center_lat = (center_bounds["minLat"] + center_bounds["maxLat"]) / 2
    lng_correction = math.cos(math.radians(center_lat))

    half_lng_span = max(center_lng - extent_bounds["minLng"], extent_bounds["maxLng"] - center_lng) * lng_correction or 1
    half_lat_span = max(center_lat - extent_bounds["minLat"], extent_bounds["maxLat"] - center_lat) or 1

    avail_w = width - padding * 2
    avail_h = height - padding * 2
    scale = min(avail_w / (2 * half_lng_span), avail_h / (2 * half_lat_span))

    cx, cy = width / 2, height / 2

    def project(lng: float, lat: float) -> tuple[float, float]:
        return (
            cx + (lng - center_lng) * lng_correction * scale,
            cy - (lat - center_lat) * scale,
        )

    return project


def main() -> None:
    tracts = json.loads((DATA_DIR / "tracts" / f"{ELMHURST_ID}.geojson").read_text())
    routes = json.loads((DATA_DIR / "routes" / f"{ELMHURST_ID}_soccer_weekday_evening.geojson").read_text())
    facilities = json.loads((DATA_DIR / "facilities" / "soccer.geojson").read_text())
    roads = json.loads((DATA_DIR / "roads" / f"{ELMHURST_ID}.geojson").read_text())

    tract_rings = [exterior_ring_of(f["geometry"]) for f in tracts["features"]]
    tract_points = [tuple(p) for ring in tract_rings for p in ring]
    center_bounds = bounds_of(tract_points)

    facility_ids = {f["properties"]["nearest_facility_id"] for f in routes["features"]}
    facility_points = [
        polygon_centroid(exterior_ring_of(f["geometry"]))
        for f in facilities["features"]
        if f["properties"]["facility_id"] in facility_ids
    ]
    extent_bounds = bounds_of(tract_points + facility_points)

    project = make_centered_projector(center_bounds, extent_bounds, MAP_W, MAP_H, PADDING)

    ss_w, ss_h = MAP_W * SUPERSAMPLE, MAP_H * SUPERSAMPLE
    img = Image.new("RGBA", (ss_w, ss_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    for line in roads["features"]:
        coords = line["geometry"]["coordinates"]
        if len(coords) < 2:
            continue
        pts = [tuple(c * SUPERSAMPLE for c in project(lng, lat)) for lng, lat in coords]
        draw.line(pts, fill=STROKE_COLOR, width=round(STROKE_WIDTH * SUPERSAMPLE), joint="curve")

    img = img.resize((MAP_W, MAP_H), Image.LANCZOS)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT_PATH)
    print(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size / 1024:.0f} KB), {len(roads['features'])} segments baked in")


if __name__ == "__main__":
    main()
