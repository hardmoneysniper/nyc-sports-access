// Mapbox GL feature-state requires a numeric id (or a string castable to a
// number) -- NTA2020 codes like "BK0401" don't qualify, so every place
// that needs a Mapbox feature id derives one from this same deterministic
// hash instead. Discovered live, 2026-09-27: Mapbox was silently dropping
// our plain string ids, leaving every rendered feature's id undefined and
// feature-state (hover/selected highlighting) unusable.
export function ntaCodeToFeatureId(ntaCode: string): number {
  let hash = 0;
  for (let i = 0; i < ntaCode.length; i++) {
    hash = (hash * 31 + ntaCode.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
