import datetime
from pipeline import config


def test_county_fips_covers_five_boroughs():
    assert config.NYC_COUNTY_FIPS == {
        "Bronx": "005",
        "Kings": "047",
        "New York": "061",
        "Queens": "081",
        "Richmond": "085",
    }
    assert config.STATE_FIPS == "36"


def test_sport_type_columns_excludes_non_sport_attributes():
    # accessible/wheelchair are accessibility flags, nonregulat/regulation are
    # facility-size flags, primary_sp is a separate categorical field — none
    # of these are sport-type categories and must not be in this list.
    excluded = {"accessible", "wheelchair", "nonregulat", "regulation", "primary_sp", "featuresta"}
    assert excluded.isdisjoint(config.SPORT_TYPE_COLUMNS)
    assert "basketball" in config.SPORT_TYPE_COLUMNS
    assert len(config.SPORT_TYPE_COLUMNS) == 23


def test_time_windows_has_four_entries_with_start_and_duration():
    assert set(config.TIME_WINDOWS) == {
        "weekday_morning",
        "weekday_noon",
        "weekend_morning",
        "weekend_noon",
    }
    morning = config.TIME_WINDOWS["weekday_morning"]
    assert morning["start_time"] == datetime.time(7, 0)
    assert morning["duration"] == datetime.timedelta(hours=2)
    assert morning["is_weekend"] is False


def test_gtfs_urls_present_for_required_agencies():
    required = {
        "subway",
        "bus_manhattan",
        "bus_brooklyn",
        "bus_bronx",
        "bus_queens",
        "bus_staten_island",
        "bus_company",
        "ferry",
    }
    assert required == set(config.GTFS_URLS)


def test_osm_extract_url_is_geofabrik_new_york_perma_alias():
    assert config.OSM_EXTRACT_URL == (
        "https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf"
    )
