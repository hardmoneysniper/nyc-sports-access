"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

const STORAGE_KEY_DEMOGRAPHIC = "selection.demographicCategory";
const STORAGE_KEY_SPORT = "selection.sportType";

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
export const SPORT_TYPES = [
  { value: "adult_baseball", label: "Adult Baseball" },
  { value: "adult_football", label: "Adult Football" },
  { value: "adult_softball", label: "Adult Softball" },
  { value: "basketball", label: "Basketball" },
  { value: "bocce", label: "Bocce" },
  { value: "cricket", label: "Cricket" },
  { value: "frisbee", label: "Frisbee" },
  { value: "handball", label: "Handball" },
  { value: "hockey", label: "Hockey" },
  { value: "kickball", label: "Kickball" },
  { value: "lacrosse", label: "Lacrosse" },
  { value: "netball", label: "Netball" },
  { value: "pickleball", label: "Pickleball" },
  { value: "rugby", label: "Rugby" },
  { value: "soccer", label: "Soccer" },
  { value: "tennis", label: "Tennis" },
  { value: "track_and_field", label: "Track and Field" },
  { value: "volleyball", label: "Volleyball" },
  { value: "youth_baseball", label: "Youth Baseball" },
  { value: "youth_football", label: "Youth Football" },
  { value: "youth_softball", label: "Youth Softball" },
] as const;

type DemographicCategory = (typeof DEMOGRAPHIC_CATEGORIES)[number]["value"];
type SportType = (typeof SPORT_TYPES)[number]["value"];

type SelectionContextValue = {
  demographicCategory: DemographicCategory;
  setDemographicCategory: (value: DemographicCategory) => void;
  sportType: SportType;
  setSportType: (value: SportType) => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  // Both selectors default to a real value now -- the travel-time page no
  // longer has an unselected/"no data" state. Per project owner
  // instruction, 2026-09-27.
  const [demographicCategory, setDemographicCategory] = useState<DemographicCategory>("pct_immigrant");
  const [sportType, setSportType] = useState<SportType>("soccer");

  // Persisted to localStorage (not just in-memory React state) so the
  // selection survives a page reload or a link opened in a new tab -- an
  // in-memory-only version of this was the likely cause of routes not
  // showing on the sample-NTA page after navigating there directly instead
  // of via an in-app client-side transition. Read on mount (useEffect, not
  // useState initializer, since localStorage doesn't exist during SSR) and
  // written on every change.
  useEffect(() => {
    try {
      const storedDemographic = localStorage.getItem(STORAGE_KEY_DEMOGRAPHIC) as DemographicCategory | null;
      if (storedDemographic && DEMOGRAPHIC_CATEGORIES.some((c) => c.value === storedDemographic)) {
        setDemographicCategory(storedDemographic);
      }
      const storedSport = localStorage.getItem(STORAGE_KEY_SPORT) as SportType | null;
      if (storedSport && SPORT_TYPES.some((s) => s.value === storedSport)) {
        setSportType(storedSport);
      }
    } catch {
      // localStorage unavailable (e.g. private browsing) -- fall back to defaults silently.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_DEMOGRAPHIC, demographicCategory);
    } catch {}
  }, [demographicCategory]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SPORT, sportType);
    } catch {}
  }, [sportType]);

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
