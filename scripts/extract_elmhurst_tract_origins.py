"""One-off extraction of Elmhurst's (QN0401) actual tract routing-origin
points, for the methodology page's Travel Time tab -- the dots shown on
the map were previously the frontend's own recomputed area-weighted
polygon centroid, which can land tens to hundreds of meters away from
where travel_time.py's routes actually start. pipeline/offsets.py uses
shapely's representative_point() (not a naive centroid) specifically so
the origin never falls outside a concave/irregularly-shaped tract; the
frontend's simple centroid has no such guarantee and doesn't agree with
it. This script calls the exact same pipeline functions
(geography.load_census_tracts + offsets.compute_origin_point) the real
run_pipeline.py setup does, so the dot the dashboard shows is
byte-identical to the point travel times are actually computed from.
Per project owner instruction, 2026-10-14 ("inspect the data and tell me
why"; "use the actual origin for the location of these dots").

Not part of the regular data pipeline -- one small static file for one
hardcoded neighborhood, same reasoning as the other scripts/extract_
elmhurst_*.py one-offs.
"""
import json
from pathlib import Path

import geopandas as gpd

from pipeline import config, geography, offsets

ELMHURST_GEOIDS = {
    "36081026700", "36081026901", "36081026902", "36081027101", "36081027102",
    "36081045700", "36081045900", "36081046100", "36081046700", "36081046901",
    "36081046902", "36081047300", "36081048100", "36081068300", "36081047900",
    "36081048500", "36081026501", "36081048301", "36081046300", "36081047100",
    "36081049900", "36081046500", "36081047500",
}
OUT_PATH = Path("frontend/public/data/tracts/QN0401_origins.geojson")


def main() -> None:
    tracts = geography.load_census_tracts()
    tracts = tracts[tracts["GEOID"].isin(ELMHURST_GEOIDS)].copy()
    if len(tracts) != len(ELMHURST_GEOIDS):
        missing = ELMHURST_GEOIDS - set(tracts["GEOID"])
        raise ValueError(f"missing tracts in shapefile: {missing}")

    tracts["origin_point"] = tracts.geometry.apply(offsets.compute_origin_point)
    origins_geo = gpd.GeoSeries(tracts["origin_point"], crs=config.CRS_PROJECTED).to_crs(config.CRS_GEOGRAPHIC)

    features = [
        {
            "type": "Feature",
            "properties": {"GEOID": geoid},
            "geometry": {"type": "Point", "coordinates": [pt.x, pt.y]},
        }
        for geoid, pt in zip(tracts["GEOID"], origins_geo)
    ]
    out = {"type": "FeatureCollection", "features": features}
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out))
    print(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes, {len(features)} tracts)")


if __name__ == "__main__":
    main()
