"""Pre-filters every NTA's route export down to soccer/weekday_evening --
the only sport+window NtaRouteDetail.tsx renders (frontend/components/
explore/NtaRouteDetail.tsx) -- instead of shipping the raw per-NTA files
(every sport x both time windows x every route option, tens of KB to >8MB
each) which aren't committed to git (see frontend/.gitignore).

Supersedes extract_elmhurst_soccer_routes.py, which did the same filtering
for just Elmhurst (QN0401). Widened to every NTA per project owner
instruction, 2026-11-18, after a teammate found the committed route data
only covered Elmhurst.
"""
import json
from pathlib import Path

SPORT = "soccer"
WINDOW = "weekday_evening"
ROUTES_DIR = Path("frontend/public/data/routes")


def round_coords(geom):
    # Elmhurst's own routes happened to be all LineStrings, but other NTAs'
    # transit segments include MultiLineString too (caught the first time
    # this ran across every NTA instead of just QN0401).
    if geom["type"] == "MultiLineString":
        geom["coordinates"] = [[[round(lon, 6), round(lat, 6)] for lon, lat in line] for line in geom["coordinates"]]
    else:
        geom["coordinates"] = [[round(lon, 6), round(lat, 6)] for lon, lat in geom["coordinates"]]
    return geom


def main() -> None:
    # Raw per-NTA exports have no underscore in their stem (e.g.
    # "QN0401.geojson"); already-filtered output does ("QN0401_soccer_
    # weekday_evening.geojson") -- excluding those keeps re-runs idempotent.
    raw_files = sorted(f for f in ROUTES_DIR.glob("*.geojson") if "_" not in f.stem)
    for src in raw_files:
        data = json.loads(src.read_text())
        features = [
            {**f, "geometry": round_coords(f["geometry"])}
            for f in data["features"]
            if f["properties"].get("sport_type") == SPORT and f["properties"].get("window_name") == WINDOW
        ]
        out = ROUTES_DIR / f"{src.stem}_{SPORT}_{WINDOW}.geojson"
        out.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
        print(f"{src.name} ({len(data['features'])} features) -> {out.name} ({len(features)} features)")


if __name__ == "__main__":
    main()
