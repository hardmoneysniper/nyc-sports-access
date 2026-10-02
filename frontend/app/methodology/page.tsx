"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import MapPageSidebar from "@/components/MapPageSidebar";

// Linked from the map page's sidebar "Methodology" item. Content is the
// Soccer Access Burden Score writeup (see
// docs/SOCCER_ACCESS_BURDEN_METHODOLOGY.md for the underlying analysis),
// split into foldable sections for readability. Per project owner
// instruction, 2026-10-02.
type Section = { title: string; body: string };

const SECTIONS: Section[] = [
  {
    title: "What this measure is for",
    body: "The goal is to find the New York City neighborhoods where residents have the hardest time reaching a soccer field compared to what we would expect, and where that gap affects the most people. The result is a ranked list of neighborhoods that can be flagged to policymakers.",
  },
  {
    title: "The data",
    body: "We started with the travel time from each of the city's 262 neighborhoods to the nearest soccer field by walking and public transit, along with each neighborhood's population and land area. Neighborhoods with no residents, such as parks, cemeteries and airports, were removed, as were neighborhoods where no field could be reached at all. That left 214 neighborhoods.",
  },
  {
    title: "Step 1: Setting an expectation",
    body: "First, we looked at how travel time to a soccer field relates to population density across the whole city. Denser neighborhoods tend to sit closer to more transit and more destinations, so we used density to estimate the travel time a neighborhood would typically have. We chose density over total population because travel time depends on how spread out a place is, and two neighborhoods with the same population can cover very different amounts of land.",
  },
  {
    title: "Step 2: Comparing actual access to the expectation",
    body: "Second, we compared each neighborhood's actual travel time to its expected travel time. If a neighborhood's residents travel longer than similar neighborhoods do, it is doing worse than expected. In other words, a neighborhood is flagged only when its access is unusually poor for its density, which is different from simply being far from the city average.",
  },
  {
    title: "Step 3: Accounting for how many people are affected",
    body: "Third, we multiplied each neighborhood's extra travel time by its population, so that a gap affecting 100,000 people ranks higher than the same gap affecting 10,000. Neighborhoods doing as well as or better than expected receive a score of zero. The score itself has no real-world unit, so only the ranking should be read and cited.",
  },
  {
    title: "What we found",
    body: "Denser neighborhoods do tend to have shorter trips to a soccer field, and density explains about 41 percent of the differences in access across the city. That still leaves most of the variation unexplained by density. Also, several of the city's larger neighborhoods, such as Forest Hills, Borough Park and Elmhurst, each home to roughly 90,000 to 100,000 people, have much worse access than neighborhoods of similar density.",
  },
  {
    title: "Why we did not divide travel time by population",
    body: "Travel time already describes what a typical resident experiences. Dividing it by population would make large neighborhoods look better off simply because they are large, which would hide exactly the underserved places this analysis is meant to find.",
  },
  {
    title: "Limitations",
    body: "Several of the top-ranked neighborhoods, such as Staten Island's south shore, the Rockaways and parts of the eastern Bronx and Queens, are on the edge of the city where transit is limited. Their low access is partly explained by that location, and it should be read that way. Also, density is calculated using each neighborhood's full land area, including parks, water and industrial land, which can make some neighborhoods look less dense than the areas where people actually live. As a result, those neighborhoods may be scored somewhat differently than their lived conditions suggest. Finally, the analysis relies on travel times from a single reference date and on population estimates from the American Community Survey.",
  },
  {
    title: "Reading the map",
    body: "The map applies this same method to all 21 sports in the dashboard. Each sport's underserved neighborhoods are split into five equal groups, colored on a light-to-dark blue scale, so that the darkest blue marks the 20 percent of underserved neighborhoods with the highest burden. Neighborhoods with a score of zero share the lightest color, since they are not part of the underserved group. Hovering over a neighborhood shows its exact score, although the color, which reflects its rank, is the more meaningful thing to look at.",
  },
];

const TRANSITION_MS = 260;

function AccordionItem({
  title,
  body,
  isOpen,
  onToggle,
}: {
  title: string;
  body: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ borderBottom: "1px solid #333" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          background: "none",
          border: "none",
          color: "#fff",
          padding: "22px 0",
          font: "inherit",
          fontSize: 19,
          fontWeight: 600,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        {title}
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            display: "inline-block",
            fontSize: 24,
            fontWeight: 300,
            lineHeight: 1,
            transform: isOpen ? "rotate(45deg)" : "rotate(0deg)",
            transition: `transform ${TRANSITION_MS}ms ease`,
          }}
        >
          +
        </span>
      </button>
      <div
        style={{
          display: "grid",
          gridTemplateRows: isOpen ? "1fr" : "0fr",
          transition: `grid-template-rows ${TRANSITION_MS}ms ease`,
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <p style={{ margin: 0, paddingBottom: 26, fontSize: 16, lineHeight: 1.65, color: "#ccc", maxWidth: 760 }}>
            {body}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function MethodologyPage() {
  const [openIndices, setOpenIndices] = useState<Set<number>>(new Set());

  const toggle = (index: number) => {
    setOpenIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div style={{ position: "relative", height: "100vh", width: "100%", overflow: "hidden", display: "flex", background: "#000" }}>
      <MapPageSidebar />
      <div
        style={{
          flex: 1,
          height: "100%",
          overflowY: "auto",
          color: "#fff",
          padding: "64px 80px 120px",
        }}
      >
        <h1 style={{ fontSize: 56, fontWeight: 700, textAlign: "left", margin: 0 }}>Methodology</h1>

        <h2 style={{ fontSize: 26, fontWeight: 600, marginTop: 56, marginBottom: 20 }}>Soccer Access Burden Score</h2>
        <p style={{ fontSize: 17, lineHeight: 1.65, color: "#ccc", maxWidth: 760, marginBottom: 20 }}>
          Not every neighborhood should be expected to have the exact same travel time to a sports facility. New York
          neighborhoods vary greatly in density, size, and urban form. Denser neighborhoods tend to sit closer to more
          transit and more destinations, so their residents usually reach a facility faster than residents of
          neighborhoods that are more spread out. For this reason, we first estimate the travel time a neighborhood
          would typically have given its density, and then compare it with the actual travel time its residents face.
          A neighborhood is flagged only when its access is unusually poor for its density, which is different from
          simply being far from the city average.
        </p>
        <p style={{ fontSize: 17, lineHeight: 1.65, color: "#ccc", maxWidth: 760 }}>
          Our Access Burden Index helps identify neighborhoods where access to a particular sport is worse than we
          would expect, especially when that gap affects a large number of residents. To calculate it, we take the
          extra travel time a neighborhood has beyond its expected travel time and multiply it by the
          neighborhood&apos;s population, so that a gap affecting 100,000 people ranks higher than the same gap affecting 10,000.
          Neighborhoods doing as well as or better than expected receive a score of zero. The score itself has no
          real-world unit, which is why the ranking is what should be read and cited.
        </p>

        <div style={{ marginTop: 48, maxWidth: 760, borderTop: "1px solid #333" }}>
          {SECTIONS.map((section, i) => (
            <AccordionItem key={section.title} title={section.title} body={section.body} isOpen={openIndices.has(i)} onToggle={() => toggle(i)} />
          ))}
        </div>
      </div>
    </div>
  );
}
