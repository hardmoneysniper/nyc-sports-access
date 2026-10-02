// Same 5-step ColorBrewer-derived blue ramp used throughout this project's
// static maps (see make_maps_binned.py), light to dark. Demographics only.
export const BIN_COLORS = ["#bdd7e7", "#6baed6", "#3182bd", "#08519c", "#08306b"];
export const NO_DATA_COLOR = "#898781";

// Fixed equal-width bins for 0-100 percentage values (demographics page).
export const PERCENT_BIN_EDGES = [0, 20, 40, 60, 80, 100];

/** binEdges has length 6 (5 bin boundaries + 1), producing 5 bins. */
export function colorForValue(value: number | null | undefined, binEdges: number[]): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NO_DATA_COLOR;
  }
  for (let i = 0; i < BIN_COLORS.length; i++) {
    const upper = binEdges[i + 1];
    const isLastBin = i === BIN_COLORS.length - 1;
    if (value <= upper || isLastBin) {
      return BIN_COLORS[i];
    }
  }
  return NO_DATA_COLOR;
}

/** Equal-count (quintile) bin edges from a set of values, ignoring nulls. */
export function quantileBinEdges(values: (number | null | undefined)[]): number[] {
  const sorted = values
    .filter((v): v is number => v !== null && v !== undefined && !Number.isNaN(v))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 0, 0, 0, 0, 0];

  const edges = [sorted[0]];
  for (let i = 1; i <= 5; i++) {
    const idx = Math.min(sorted.length - 1, Math.floor((i / 5) * sorted.length) - (i === 5 ? 1 : 0));
    edges.push(sorted[Math.max(0, idx)]);
  }
  return edges;
}

export function binLabel(binEdges: number[], index: number, suffix = ""): string {
  const lower = index === 0 ? binEdges[0] : binEdges[index];
  const upper = binEdges[index + 1];
  return `${lower.toFixed(1)}–${upper.toFixed(1)}${suffix}`;
}

// --- Burden-index map only. burden_index is already floored at 0 by
// export_burden_index() (residual.clip(lower=0)), so it never holds
// negative values -- NTAs at or below 0 ("no excess burden") share the
// SAME color as the bottom 20th-percentile band, not a separate shade (a
// separate pale shade was tried and reported confusable with it). Kept
// separate from colorForValue/quantileBinEdges above so demographics
// (where 0% is a normal, meaningful value, not a special case) is
// completely unaffected, even though the colors are now the same ramp. ---

// Same blue ramp as the demographics map (BIN_COLORS), per project owner
// instruction, 2026-09-29 -- reusing it directly (not a copy) so the two
// never drift apart.
export const BURDEN_BIN_COLORS = BIN_COLORS;
// "Nth percentile" (the band's upper cutoff), not a "low-high" range --
// per project owner instruction, 2026-09-29.
export const BURDEN_BAND_LABELS = ["20th percentile", "40th percentile", "60th percentile", "80th percentile", "100th percentile"];

/**
 * Equal-count (quintile) bin edges computed from only the POSITIVE values
 * in a set (ignoring nulls, zeros, and negatives) -- the burden-index
 * legend's 5 color bands only ever describe the underserved half of NTAs;
 * the rest get the bottom band's color instead of diluting the gradient
 * the way including them in an ordinary quantile split would.
 */
export function positiveQuantileBinEdges(values: (number | null | undefined)[]): number[] {
  const positive = values
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v) && v > 0)
    .sort((a, b) => a - b);
  if (positive.length === 0) return [0, 0, 0, 0, 0, 0];

  const edges = [positive[0]];
  for (let i = 1; i <= 5; i++) {
    const idx = Math.min(positive.length - 1, Math.floor((i / 5) * positive.length) - (i === 5 ? 1 : 0));
    edges.push(positive[Math.max(0, idx)]);
  }
  return edges;
}

/**
 * Equal-WIDTH bin edges: 5 even divisions of [0, max positive value] --
 * an experiment for soccer only (see explore/page.tsx), to compare against
 * the equal-count quantile version above. Per project owner instruction,
 * 2026-09-29.
 */
export function equalWidthPositiveBinEdges(values: (number | null | undefined)[]): number[] {
  const positive = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v) && v > 0);
  if (positive.length === 0) return [0, 0, 0, 0, 0, 0];

  const max = Math.max(...positive);
  const edges = [0];
  for (let i = 1; i <= 5; i++) edges.push((max * i) / 5);
  return edges;
}

function burdenBandIndex(value: number, positiveBinEdges: number[]): number {
  for (let i = 0; i < BURDEN_BIN_COLORS.length; i++) {
    const upper = positiveBinEdges[i + 1];
    const isLastBin = i === BURDEN_BIN_COLORS.length - 1;
    if (value <= upper || isLastBin) return i;
  }
  return BURDEN_BIN_COLORS.length - 1;
}

export function colorForBurdenValue(value: number | null | undefined, positiveBinEdges: number[]): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NO_DATA_COLOR;
  if (value <= 0) return BURDEN_BIN_COLORS[0];
  return BURDEN_BIN_COLORS[burdenBandIndex(value, positiveBinEdges)];
}

export function burdenBandLabel(value: number | null | undefined, positiveBinEdges: number[]): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "No data";
  if (value <= 0) return BURDEN_BAND_LABELS[0];
  return BURDEN_BAND_LABELS[burdenBandIndex(value, positiveBinEdges)];
}
