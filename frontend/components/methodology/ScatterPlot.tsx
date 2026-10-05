// Reusable inline-SVG scatter for the Burden Score tab's regression
// scrollytelling -- no charting library, since the page's explicit style
// requirement (black/transparent background, white everything else) is
// easiest to guarantee with full manual control over every element. Per
// project owner instruction, 2026-10-05.
export type ScatterPoint = { id: string; x: number; y: number };

const PAD_LEFT = 56;
const PAD_BOTTOM = 40;
const PAD_TOP = 24;
// A small, square-friendly margin. Making this big enough to hold the
// label inline distorted the plot into a tall narrow rectangle; clamping
// the label's own x position to stay inside the canvas instead let it
// drift left of the point it's labeling when that point sits near the
// domain's edge. Neither preserved both "square plot" and "label strictly
// to the point's right, same position everywhere" at once, so the SVG
// goes back to overflow:visible (below) and lets the label spill into the
// page's own margin around the (now appropriately small, centered)
// diagram instead. Reported live, 2026-10-05.
const PAD_RIGHT = 16;

function niceTicks(domain: [number, number], count: number): number[] {
  const [lo, hi] = domain;
  const step = (hi - lo) / (count - 1);
  return Array.from({ length: count }, (_, i) => lo + step * i);
}

// Multi-line label, always drawn to the point's right at a fixed offset --
// never flipped to the left (that put it back over the point cloud/fitted
// line it was meant to describe) and never clamped to the canvas width
// (that let it drift left of the point near the domain's edge). A fixed
// offset is also what guarantees it sits at the exact same position
// relative to the point in every scene, since the point's own projected
// position doesn't change between scenes. Flips above/below the point
// only, to stay inside the plot's top edge. A solid backdrop rect sits
// behind the text so it stays legible over other points/lines in dense
// views. Reported live, 2026-10-05.
function PointLabel({ x, y, lines, plotH }: { x: number; y: number; lines: string[]; plotH: number }) {
  const anchorBottom = y < PAD_TOP + plotH * 0.25;
  const dx = 10;
  const fontSize = 10.5;
  const lineHeight = 12;
  const firstLineDy = anchorBottom ? 16 : -8 - (lines.length - 1) * lineHeight;

  const padX = 4;
  const padY = 3;
  const textWidth = Math.max(...lines.map((l) => l.length)) * fontSize * 0.62;
  const rectX = x + dx - padX;
  const rectY = y + firstLineDy - fontSize - padY;
  const rectW = textWidth + padX * 2;
  const rectH = lines.length * lineHeight + padY * 2;

  return (
    <>
      <rect x={rectX} y={rectY} width={rectW} height={rectH} fill="#000" fillOpacity={0.85} />
      <text x={x + dx} y={y + firstLineDy} fill="#fff" fontSize={fontSize} fontWeight={600} textAnchor="start">
        {lines.map((line, i) => (
          <tspan key={i} x={x + dx} dy={i === 0 ? 0 : lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    </>
  );
}

export default function ScatterPlot({
  points,
  width,
  height,
  xDomain,
  yDomain,
  xLabel,
  yLabel,
  xTickFormat = (v) => v.toFixed(1),
  yTickFormat = (v) => v.toFixed(0),
  fittedLine,
  formulaLabel,
  highlightedId = null,
  highlightedLabel,
  isolateHighlighted = false,
  showResidualFor = null,
  expectedPointFor = null,
  expectedLabel,
}: {
  points: ScatterPoint[];
  width: number;
  height: number;
  xDomain: [number, number];
  yDomain: [number, number];
  xLabel: string;
  yLabel: string;
  xTickFormat?: (v: number) => string;
  yTickFormat?: (v: number) => string;
  fittedLine?: { slope: number; intercept: number };
  formulaLabel?: string;
  highlightedId?: string | null;
  /** Label drawn next to the highlighted (actual) point -- a single string or multiple lines. */
  highlightedLabel?: string | string[];
  isolateHighlighted?: boolean;
  showResidualFor?: string | null;
  /** Draws a white-edge/black-fill marker on the fitted line at this point's x (the "expected" value). */
  expectedPointFor?: string | null;
  expectedLabel?: string | string[];
}) {
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;

  const sx = (x: number) => PAD_LEFT + ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotW;
  const sy = (y: number) => PAD_TOP + plotH - ((y - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotH;

  const xTicks = niceTicks(xDomain, 4);
  const yTicks = niceTicks(yDomain, 4);

  const highlighted = points.find((p) => p.id === highlightedId) ?? null;
  const residualPoint = points.find((p) => p.id === showResidualFor) ?? null;
  const predictedAtResidual =
    residualPoint && fittedLine ? fittedLine.intercept + fittedLine.slope * residualPoint.x : null;

  const expectedSource = points.find((p) => p.id === expectedPointFor) ?? null;
  const expectedY = expectedSource && fittedLine ? fittedLine.intercept + fittedLine.slope * expectedSource.x : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ display: "block", width: "100%", height: "auto", overflow: "visible" }}>
      {/* axes */}
      <line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={PAD_TOP + plotH} stroke="#fff" strokeOpacity={0.4} />
      <line
        x1={PAD_LEFT}
        y1={PAD_TOP + plotH}
        x2={PAD_LEFT + plotW}
        y2={PAD_TOP + plotH}
        stroke="#fff"
        strokeOpacity={0.4}
      />
      {xTicks.map((t) => (
        <text key={`xt-${t}`} x={sx(t)} y={PAD_TOP + plotH + 18} fill="#fff" fillOpacity={0.6} fontSize={11} textAnchor="middle">
          {xTickFormat(t)}
        </text>
      ))}
      {yTicks.map((t) => (
        <text key={`yt-${t}`} x={PAD_LEFT - 8} y={sy(t) + 4} fill="#fff" fillOpacity={0.6} fontSize={11} textAnchor="end">
          {yTickFormat(t)}
        </text>
      ))}
      <text x={PAD_LEFT + plotW / 2} y={height - 4} fill="#fff" fontSize={12} textAnchor="middle">
        {xLabel}
      </text>
      <text
        x={14}
        y={PAD_TOP + plotH / 2}
        fill="#fff"
        fontSize={12}
        textAnchor="middle"
        transform={`rotate(-90, 14, ${PAD_TOP + plotH / 2})`}
      >
        {yLabel}
      </text>

      {/* fitted line */}
      {fittedLine && (
        <line
          x1={sx(xDomain[0])}
          y1={sy(fittedLine.intercept + fittedLine.slope * xDomain[0])}
          x2={sx(xDomain[1])}
          y2={sy(fittedLine.intercept + fittedLine.slope * xDomain[1])}
          stroke="#fff"
          strokeWidth={1.5}
        />
      )}
      {fittedLine && formulaLabel && (
        <text x={PAD_LEFT + plotW - 4} y={PAD_TOP + 14} fill="#fff" fontSize={12} textAnchor="end" fontFamily="monospace">
          {formulaLabel}
        </text>
      )}

      {/* residual (dashed segment from actual to predicted, at the same x) */}
      {residualPoint && predictedAtResidual !== null && (
        <line
          x1={sx(residualPoint.x)}
          y1={sy(residualPoint.y)}
          x2={sx(residualPoint.x)}
          y2={sy(predictedAtResidual)}
          stroke="#fff"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      )}

      {/* points */}
      {points.map((p) => {
        const isHighlighted = p.id === highlightedId;
        if (isolateHighlighted && !isHighlighted) return null;
        return (
          <circle
            key={p.id}
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={isHighlighted ? 6 : 3}
            fill="#fff"
            fillOpacity={isHighlighted ? 1 : 0.55}
            stroke={isHighlighted ? "#000" : "none"}
            strokeWidth={isHighlighted ? 1 : 0}
          />
        );
      })}

      {/* expected-value marker: white edge, black center, so it reads as
          distinct from the (solid white) actual-value points. */}
      {expectedSource && expectedY !== null && (
        <circle cx={sx(expectedSource.x)} cy={sy(expectedY)} r={6} fill="#000" stroke="#fff" strokeWidth={2} />
      )}

      {highlighted && highlightedLabel && (
        <PointLabel
          x={sx(highlighted.x)}
          y={sy(highlighted.y)}
          lines={Array.isArray(highlightedLabel) ? highlightedLabel : [highlightedLabel]}
          plotH={plotH}
        />
      )}

      {expectedSource && expectedY !== null && expectedLabel && (
        <PointLabel
          x={sx(expectedSource.x)}
          y={sy(expectedY)}
          lines={Array.isArray(expectedLabel) ? expectedLabel : [expectedLabel]}
          plotH={plotH}
        />
      )}
    </svg>
  );
}
