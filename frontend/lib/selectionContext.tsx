"use client";

import { createContext, useContext, useState, ReactNode } from "react";

// Narrowed down from the original 6 race/ethnicity + immigrant categories
// to just immigrant/foreign-born plus 5 new ones, ranked in this order:
// identity (immigrant), economic hardship (poverty, income), transit
// dependency (vehicle access -- the one most directly tied to this
// project's own subject matter), then the two age groups most sensitive
// to a given travel time (youth, seniors). Per project owner instruction,
// 2026-11-09. `unit` drives how each category's values are scaled/
// formatted on the map legend and the burden/demographic scatter (see
// formatDemographicValue below) -- every category here is a percentage
// except median_household_income, a dollar figure.
export const DEMOGRAPHIC_CATEGORIES = [
  { value: "pct_immigrant", label: "Immigrant / foreign-born", unit: "percent" },
  { value: "pct_poverty", label: "Poverty rate", unit: "percent" },
  { value: "median_household_income", label: "Median household income", unit: "currency" },
  { value: "pct_no_vehicle", label: "No vehicle access", unit: "percent" },
  { value: "pct_youth", label: "Youth (under 18)", unit: "percent" },
  { value: "pct_senior", label: "Seniors (65+)", unit: "percent" },
] as const;

export type DemographicUnit = (typeof DEMOGRAPHIC_CATEGORIES)[number]["unit"];

export function formatDemographicValue(value: number, unit: DemographicUnit): string {
  return unit === "currency" ? `$${Math.round(value).toLocaleString()}` : `${value.toFixed(1)}%`;
}

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

export const ACCESS_METRICS = [
  { value: "burden_index", label: "Access Burden Score" },
  { value: "travel_time", label: "Average Travel Time" },
] as const;
export type AccessMetric = (typeof ACCESS_METRICS)[number]["value"];

type SelectionContextValue = {
  accessMetric: AccessMetric | null;
  setAccessMetric: (value: AccessMetric | null) => void;
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
  const [accessMetric, setAccessMetric] = useState<AccessMetric | null>(null);
  const [sportType, setSportType] = useState<SportType | null>(null);

  return (
    <SelectionContext.Provider
      value={{ accessMetric, setAccessMetric, demographicCategory, setDemographicCategory, sportType, setSportType }}
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
