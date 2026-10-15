export type InvestmentPriority = { id: string; name: string; score: number };

export function rankInvestmentPriorities(data: GeoJSON.FeatureCollection, property: string): InvestmentPriority[] {
  return data.features.flatMap((feature) => {
    const p = feature.properties;
    const score = p?.[property];
    return typeof p?.NTA2020 === "string" && typeof score === "number" && Number.isFinite(score) && score > 0
      ? [{ id: p.NTA2020, name: String(p.NTAName ?? p.NTA2020), score }]
      : [];
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 10);
}
