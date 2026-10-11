// Reusable legend box matching 2C.png: title, a horizontal row of 5 color
// swatches, tick labels underneath. Positioned by the caller (absolute,
// within that map pane's own wrapper) -- one instance per pane, not a
// single shared corner, per project owner instruction, 2026-10-05.
export default function MapLegend({
  title,
  colors,
  labels,
}: {
  title: string;
  colors: readonly string[];
  labels: readonly string[];
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 1000,
        background: "#000",
        border: "1px solid #333",
        borderRadius: 4,
        padding: "10px 14px",
        color: "#fff",
        fontSize: 13,
        boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8, whiteSpace: "nowrap" }}>{title}</div>
      <div style={{ display: "flex" }}>
        {colors.map((c, i) => (
          <div key={i} style={{ width: 34, height: 12, background: c }} />
        ))}
      </div>
      <div style={{ display: "flex", marginTop: 4 }}>
        {labels.map((label, i) => (
          // No nowrap -- long labels like "20th percentile" wrap onto 2
          // lines within the narrow swatch column instead of overflowing
          // into neighboring columns. Left-aligned (not centered) and a
          // smaller font -- centered wrapped text spilled past its own
          // 34px column on both sides and visibly collided with the
          // neighboring label. Reported live, 2026-10-11 ("the text on
          // the map legends are overlapping... especially percentile").
          <div key={i} style={{ width: 34, fontSize: 8, color: "#aaa", textAlign: "left", lineHeight: 1.2 }}>
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
