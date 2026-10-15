"use client";

import { useState } from "react";

// Foldable catalog of data sources, per "data source.png" -- each tab is a
// dataset: a short, plain-spoken note on what we actually use it for, all
// folded by default, plus a source/link table with the real citations the
// project owner gave us. Independently foldable (not a one-at-a-time
// accordion like the map page's catalog) -- the mockup doesn't suggest
// opening one should close another, and there's no reason reading two
// sections at once should be disallowed here. Per project owner
// instruction, 2026-10-14 (real sources/links, human-sounding
// descriptions, dropped the standalone "Demographic" tab since the
// project owner's own source list folds NTA-level demographics into the
// NTA entry itself, used exact titles as given).

type SourceRow = { source: string; href: string };

type DataSourceSection = {
  id: string;
  title: string;
  description: string;
  rows: SourceRow[];
};

const SECTIONS: DataSourceSection[] = [
  {
    id: "census-tract",
    title: "Census Tract Data",
    description:
      "We route every trip from a census tract's own midpoint, not from the neighborhood as a whole -- tracts are small enough that two residents on opposite sides of a big NTA still each get a travel time that reflects where they actually live, instead of being flattened into one neighborhood-wide number.",
    rows: [
      {
        source: "Census Tract Data",
        href: "https://data.cityofnewyork.us/City-Government/2020-Census-Tracts/63ge-mke6/about_data",
      },
    ],
  },
  {
    id: "nta",
    title: "Neighborhood Tabulation Area Data",
    description:
      "This is both the boundary we report every score and map at, and where we get the population counts and demographic percentages (race, ethnicity, immigrant share, and more) that tell us who's actually affected when a neighborhood's access falls short.",
    rows: [
      {
        source: "NTA demographics data",
        href: "https://www.nyc.gov/content/planning/pages/resources/datasets/neighborhood-tabulation",
      },
    ],
  },
  {
    id: "facilities",
    title: "Athletic Facilities",
    description:
      "Every travel time we calculate is a trip to one of these -- we only count facilities that are currently active, narrowed down to whichever sport we're scoring at the time.",
    rows: [{ source: "Sports Facilities", href: "https://data.cityofnewyork.us/dataset/Athletic-Facilities/qpgi-ckmp" }],
  },
  {
    id: "transit",
    title: "Transit and Streets",
    description:
      "This is what we actually simulate for every trip: real bus, subway, and ferry schedules laid over the real street and path network, so a travel time reflects what a rider would really experience -- walking, waiting, and riding -- not just a straight line between two points.",
    rows: [
      { source: "Street network", href: "https://data.cityofnewyork.us/City-Government/LION/2v4z-66xt/about_data" },
      { source: "NYCT Bus Static GTFS", href: "https://www.mta.info/developers" },
    ],
  },
];

function Chevron({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      width={16}
      height={10}
      viewBox="0 0 16 10"
      fill="none"
      aria-hidden
      style={{ flexShrink: 0, transform: direction === "up" ? "rotate(180deg)" : "none" }}
    >
      <path d="M1 1.5L8 8.5L15 1.5" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SourceTable({ rows }: { rows: SourceRow[] }) {
  return (
    <div style={{ border: "1px solid #444", marginTop: 20 }}>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            borderTop: i === 0 ? "none" : "1px solid #444",
          }}
        >
          {/* flex:1 on both cells (not a fixed width) -- the source name
              wraps onto a 2nd line via normal CSS flow (no whiteSpace:
              nowrap anywhere) whenever the page is too narrow to fit it on
              one, rather than overflowing or forcing horizontal scroll.
              Per project owner instruction, 2026-10-14. The link itself is
              always just the word "View" -- the real destination is the
              href, not something that needs to fit inline as raw URL
              text. */}
          <div style={{ flex: 1, padding: "14px 20px", borderRight: "1px solid #444", color: "#fff", fontSize: 16, wordBreak: "break-word" }}>
            {row.source}
          </div>
          <div style={{ flex: 1, padding: "14px 20px", fontSize: 16 }}>
            <a href={row.href} target="_blank" rel="noopener noreferrer" style={{ color: "#fff", textDecoration: "underline" }}>
              View
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}

function DataSourceSectionRow({
  section,
  expanded,
  onToggle,
}: {
  section: DataSourceSection;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <section style={{ marginTop: 40 }}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }}
      >
        <h2 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>{section.title}</h2>
        <Chevron direction={expanded ? "up" : "down"} />
      </div>
      {/* grid-template-rows 0fr<->1fr (not a conditional mount/unmount) --
          the standard CSS-only way to animate to/from an auto (content-
          dependent) height, since height itself can't be transitioned
          to/from "auto" directly. minHeight:0 on the inner grid item is
          required for it to actually shrink past its content's natural
          height instead of just clipping during the transition. Per
          project owner instruction, 2026-10-14 ("a smooth animation for
          the unfold/fold"). */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transition: "grid-template-rows 300ms ease",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <p style={{ fontSize: 18, lineHeight: 1.65, color: "#ccc", marginTop: 16 }}>{section.description}</p>
          <SourceTable rows={section.rows} />
        </div>
      </div>
    </section>
  );
}

export default function DataSourceTab() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div>
      <h1 style={{ fontSize: 48, fontWeight: 700, margin: 0 }}>Data Source</h1>

      {SECTIONS.map((section) => (
        <DataSourceSectionRow
          key={section.id}
          section={section}
          expanded={!!expanded[section.id]}
          onToggle={() => setExpanded((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
        />
      ))}
    </div>
  );
}
