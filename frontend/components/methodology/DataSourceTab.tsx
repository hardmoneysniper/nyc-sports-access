// Plain-language summary of data provenance, condensed from
// docs/METHODOLOGY.md sections 2 (source data), 4 (demographics), 5
// (facilities), and 6 (travel-time computation). No accordion, full width,
// matching the rest of the methodology page. Per project owner
// instruction, 2026-10-05.
export default function DataSourceTab() {
  return (
    <div>
      <h1 style={{ fontSize: 48, fontWeight: 700, margin: 0 }}>Data Source</h1>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>Neighborhoods and census tracts</h2>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc" }}>
          Neighborhood boundaries and the census tracts inside them come from the NYC Department of City Planning.
          Census tracts are the unit we route from, since they&apos;re small enough to give each part of a
          neighborhood its own travel time; neighborhoods are the unit we report at.
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>Population and demographics</h2>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc" }}>
          Population and demographic percentages come from the U.S. Census Bureau&apos;s American Community Survey
          (2020–2024 5-year estimates), pulled at the census-tract level and combined up to each neighborhood.
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>Sports facilities</h2>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc" }}>
          Facility locations come from New York City&apos;s own athletic facilities dataset, filtered to currently
          active facilities only.
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>Transit and streets</h2>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc" }}>
          Travel times are computed from real transit schedules (the subway, every city bus route, and NYC Ferry) and
          the actual street and path network from OpenStreetMap, combined with an open-source routing engine that
          simulates real trips (walking, waiting for and riding transit, and walking again) rather than estimating
          distance as the crow flies.
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>When the data is from</h2>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "#ccc" }}>
          Travel times reflect transit schedules on a representative weekday and weekend, at four points during the
          day. Demographic estimates are a 5-year rolling average, not a single-year snapshot.
        </p>
      </section>
    </div>
  );
}
