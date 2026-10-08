// Stacked fraction (horizontal bar, numerator over denominator) for the
// Access Burden Score formula's Population/10,000 term, matching
// burden-score-page.png's mathematical notation instead of "/" or "÷".
// Per project owner instruction, 2026-10-08.
export default function Fraction({ numerator, denominator }: { numerator: string; denominator: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        verticalAlign: "middle",
        margin: "0 8px",
        lineHeight: 1.3,
      }}
    >
      <span style={{ borderBottom: "1px solid #fff", padding: "0 6px" }}>{numerator}</span>
      <span style={{ padding: "0 6px" }}>{denominator}</span>
    </span>
  );
}
