"""One-off extraction of real OSM street geometry around Elmhurst (QN0401),
for the methodology page's decorative-but-real road-network backdrop.

Not part of the regular data pipeline (export_dashboard_data.py) -- this is
a single illustrative worked example tied to one hardcoded neighborhood, so
a one-off script producing one static file is simpler than wiring a new
pipeline stage. Per project owner instruction, 2026-10-05 ("it should
reflect the shape of the ACTUAL road network in the region").
"""
import json
import time
from pathlib import Path

import osmium
from osmium.osm import osm_entity_bits
from shapely.geometry import LineString, box

PBF_PATH = Path("data/network/new-york.osm.pbf")
OUT_PATH = Path("frontend/public/data/roads/QN0401.geojson")

# Matches the actual map viewframe computed by makeCenteredProjector (NTA
# center +/- the half-span needed to fit the farthest-out soccer facility,
# with ~15% headroom) -- not just a fixed pad around the NTA's own tract
# bounds. The old, tighter bbox left several of Elmhurst's nearest soccer
# fields (some ~5-7km out) sitting on a patch of map with no road backdrop
# at all. Per project owner instruction, 2026-10-05 ("the road network
# should... cover the soccer fields, optimally filling the width of the
# map's viewframe").
MIN_LNG, MAX_LNG = -73.9597, -73.8005
# Taller than the map's own vertical extent -- extra headroom top and
# bottom. Per project owner instruction, 2026-10-05 (asked twice to make
# this taller).
MIN_LAT, MAX_LAT = 40.7066, 40.7705


# Real streets only -- excludes footway/path/steps/cycleway/track/elevator,
# which otherwise outnumber actual roads ~5-to-1 in this bbox and would
# make the backdrop read as sidewalk clutter rather than a street map.
ROAD_VALUES = {
    "motorway", "motorway_link",
    "primary", "primary_link",
    "secondary", "secondary_link",
    "tertiary", "tertiary_link",
    "residential", "living_street",
}


# Clip every way to this exact rectangle instead of just keeping whole ways
# that happen to pass through it -- keeping whole ways let streets that
# cross the bbox boundary at an angle dangle past it in whatever direction
# they actually run, giving the road network a ragged, non-rectangular
# silhouette instead of a clean straight-edged cutoff. Per project owner
# instruction, 2026-10-05 ("straight and perpendicular edges... use the
# current max top/left/bot/right cutoff as the edge reference points").
CLIP_BOX = box(MIN_LNG, MIN_LAT, MAX_LNG, MAX_LAT)


def clipped_lines(coords: list[list[float]]) -> list[list[list[float]]]:
    clipped = CLIP_BOX.intersection(LineString(coords))
    if clipped.is_empty:
        return []
    geom_type = clipped.geom_type
    if geom_type == "LineString":
        parts = [clipped]
    elif geom_type == "MultiLineString":
        parts = list(clipped.geoms)
    elif geom_type == "GeometryCollection":
        parts = [g for g in clipped.geoms if g.geom_type == "LineString"]
    else:
        return []
    return [[[round(x, 5), round(y, 5)] for x, y in part.coords] for part in parts if len(part.coords) >= 2]


def main() -> None:
    start = time.time()
    fp = (
        osmium.FileProcessor(str(PBF_PATH), osm_entity_bits.NODE | osm_entity_bits.WAY)
        .with_filter(osmium.filter.KeyFilter("highway"))
        .with_locations()
    )

    lines: list[list[list[float]]] = []
    ways_seen = 0
    for obj in fp:
        if not obj.is_way():
            continue
        if obj.tags.get("highway") not in ROAD_VALUES:
            continue
        ways_seen += 1
        coords = []
        for n in obj.nodes:
            if not n.location.valid():
                continue
            coords.append([n.location.lon, n.location.lat])
        if len(coords) < 2:
            continue
        lines.extend(clipped_lines(coords))

    elapsed = time.time() - start
    print(f"scanned {ways_seen} road ways in {elapsed:.1f}s, kept {len(lines)} clipped segments")

    fc = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": coords}}
            for coords in lines
        ],
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(fc))
    print(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
