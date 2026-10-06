"""One-off pre-filter of Elmhurst's route file down to just the worked
example's sport/window, for the methodology page's Travel Time tab.

routes/QN0401.geojson (pipeline output, export_dashboard_data.py) has 4,128
features: every sport x both time windows x every route option for all 23
of Elmhurst's tracts. The Travel Time tab only ever needs soccer /
weekday_evening (62 features) but was fetching and parsing the whole 6.2MB
file client-side just to filter it down -- this writes that already-
filtered subset to its own file instead. Kept separate from
routes/QN0401.geojson (not overwritten in place) since that file is
pipeline-generated and would get silently regenerated back to full size on
the next pipeline run. Per project owner instruction, 2026-10-06 ("the
travel time maps are loaded pretty slowly").
"""
import json
from pathlib import Path

SPORT = "soccer"
WINDOW = "weekday_evening"
SRC = Path("frontend/public/data/routes/QN0401.geojson")
OUT = Path("frontend/public/data/routes/QN0401_soccer_weekday_evening.geojson")


def round_coords(geom):
    coords = geom["coordinates"]
    geom["coordinates"] = [[round(lon, 6), round(lat, 6)] for lon, lat in coords]
    return geom


def main() -> None:
    data = json.loads(SRC.read_text())
    features = [
        {**f, "geometry": round_coords(f["geometry"])}
        for f in data["features"]
        if f["properties"].get("sport_type") == SPORT and f["properties"].get("window_name") == WINDOW
    ]
    out = {"type": "FeatureCollection", "features": features}
    OUT.write_text(json.dumps(out))
    print(f"{SRC} ({SRC.stat().st_size / 1024:.0f} KB, {len(data['features'])} features) -> "
          f"{OUT} ({OUT.stat().st_size / 1024:.0f} KB, {len(features)} features)")


if __name__ == "__main__":
    main()
