// Same 5-step ColorBrewer-derived blue ramp used throughout this project's
// static maps (see make_maps_binned.py), light to dark.
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
