"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export const DEMOGRAPHIC_CATEGORIES = [
  { value: "pct_non_white", label: "Non-white" },
  { value: "pct_hispanic_or_latino", label: "Hispanic or Latino" },
  { value: "pct_black_or_african_american", label: "Black or African American" },
  { value: "pct_asian", label: "Asian" },
  { value: "pct_two_or_more_races", label: "Two or more races" },
  { value: "pct_immigrant", label: "Immigrant / foreign-born" },
] as const;

// Matches pipeline.config.SPORT_TYPE_GROUPS' keys -- display-level
// categories, not the 24 raw shapefile sport-type columns. Some of these
// (youth_baseball, adult_football) are an aggregate of multiple raw
// columns; export_dashboard_data.py's export_travel_time() does the
// aggregation (min() of travel time across a group's member columns) when
// it writes travel_time.geojson. Per project owner instruction,
// 2026-09-27.
// Ordered alphabetically by label (not by value/group) -- per project
// owner instruction, 2026-09-27.
export const SPORT_TYPES = [
  { value: "adult_baseball", label: "Baseball (Adult)" },
  { value: "youth_baseball", label: "Baseball (Youth)" },
  { value: "basketball", label: "Basketball" },
  { value: "bocce", label: "Bocce" },
  { value: "cricket", label: "Cricket" },
  { value: "adult_football", label: "Football (Adult)" },
  { value: "youth_football", label: "Football (Youth)" },
  { value: "frisbee", label: "Frisbee" },
  { value: "handball", label: "Handball" },
  { value: "hockey", label: "Hockey" },
  { value: "kickball", label: "Kickball" },
  { value: "lacrosse", label: "Lacrosse" },
  { value: "netball", label: "Netball" },
  { value: "pickleball", label: "Pickleball" },
  { value: "rugby", label: "Rugby" },
  { value: "soccer", label: "Soccer" },
  { value: "adult_softball", label: "Softball (Adult)" },
  { value: "youth_softball", label: "Softball (Youth)" },
  { value: "tennis", label: "Tennis" },
  { value: "track_and_field", label: "Track and Field" },
  { value: "volleyball", label: "Volleyball" },
] as const;

type DemographicCategory = (typeof DEMOGRAPHIC_CATEGORIES)[number]["value"];
type SportType = (typeof SPORT_TYPES)[number]["value"];
export type DemographicCategoryValue = DemographicCategory;
export type SportTypeValue = SportType;

type SelectionContextValue = {
  demographicCategory: DemographicCategory | null;
  setDemographicCategory: (value: DemographicCategory | null) => void;
  sportType: SportType | null;
  setSportType: (value: SportType | null) => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  // Both selectors default to null (nothing selected, blank map) on every
  // entry to the page -- no localStorage restore. An earlier version of
  // this persisted the last selection to localStorage and restored it on
  // mount, which meant reloading or revisiting /explore came back with
  // whatever was selected last, instead of the intended blank-by-default
  // state. Per project owner instruction, 2026-10-08 ("the default...
  // should be nothing is selected").
  const [demographicCategory, setDemographicCategory] = useState<DemographicCategory | null>(null);
  const [sportType, setSportType] = useState<SportType | null>(null);

  return (
    <SelectionContext.Provider
      value={{ demographicCategory, setDemographicCategory, sportType, setSportType }}
    >
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection() {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error("useSelection must be used within a SelectionProvider");
  }
  return context;
}
