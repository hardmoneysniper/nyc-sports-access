# Methodology: Soccer Access Burden Score

Downstream analysis for the dashboard's planned "statement page" (the page after the landing page). Reads already-computed pipeline output — does not recompute travel times or touch r5py. See [docs/METHODOLOGY.md](METHODOLOGY.md) for how `total_population` and `travel_time_soccer` were derived upstream.

Implemented in `compute_soccer_access_burden.py`; run with `python compute_soccer_access_burden.py`.

## 1. Purpose

Produce a defensible, ranked shortlist of NTAs to flag to policymakers for the article's thesis, without relying on a raw division of travel time by population (rejected — see §7).

## 2. Inputs

| Source | Fields used |
|---|---|
| `data/processed/nta_output.geojson` | `NTA2020`, `NTAName`, `total_population`, `geometry` (geometry only for the area/density computation, §3) |
| `data/processed/nta_output_combined_time.csv` | `NTA2020`, `travel_time_soccer` (weekday-frequency-weighted combined value, §8 of METHODOLOGY.md) |

Merged on `NTA2020` (inner join, 262 NTAs). NTAs with missing `travel_time_soccer` (unreachable in every window, §11 of METHODOLOGY.md) or zero/missing `total_population` (parks, cemeteries, airports — no residents to be underserved) are dropped, leaving **214 NTAs**.

## 3. Step 1 — Citywide expectation (regression)

Ordinary least squares, `travel_time_soccer` regressed on `log(population_density)` — **not** raw population (revised 2026-09-29; see rationale below):

```
area_sqmi = geometry reprojected to EPSG:2263 (feet, this pipeline's standard projected CRS — see §3 of METHODOLOGY.md) .area / 5280²
density = total_population / area_sqmi
predicted_travel_time = intercept + slope × log(density)
```

**Why density instead of population for this step**: travel time is fundamentally a spatial/geometric quantity, and density (people per square mile) captures urban form and geographic spread directly, while raw population conflates headcount with however large or small an NTA's land area happens to be — two NTAs can share a population but differ hugely in area, and only density sees that. Tested empirically against this same data: `log(density)` gives **r² = 0.41**, nearly double `log(population)`'s r² = 0.23. `log(·)` is used (for both) because the underlying quantity is right-skewed across NTAs; fitting on the raw value lets a handful of extreme NTAs dominate the line.

The fitted slope, its p-value, and r² are the direct answer to "does density predict access?" — this is the citywide claim, expressed as one model instead of a bare correlation coefficient, chosen specifically because its residuals (§4) are also the input to the ranking (§5). One model produces both halves of the story.

Note this is a narrower claim than the article's original population-only framing (§9) — switching the predictor changes *what's being tested*, not just which variable happens to fit better.

## 4. Step 2 — Residual

```
residual = travel_time_soccer − predicted_travel_time
```

Positive residual: this NTA's actual access is worse than a neighborhood of its density typically gets. Negative: better than expected. This is "expected access controlling for density," not a flat citywide median — an NTA is only flagged for defying the density/access relationship, not merely for being far from average.

## 5. Step 3 — Burden score

```
excess_residual = max(residual, 0)
burden_score = excess_residual × (total_population ÷ 10,000)
```

Negative residuals are clipped to zero — only underperforming NTAs are ranked. The weight here is **raw population, not density** — deliberately a different variable than the regression predictor in §3. Weighting is meant to answer "how many actual residents does this affect," and two NTAs with equal population but different density represent the same number of underserved people regardless of how spread out they are; weighting by density would inflate the denser one's score and deflate the sparser one's even though the same number of real people are affected in both. Multiplying (not dividing) by population means a bad residual affecting more residents produces a larger score, rather than diluting them the way a per-capita ratio would (§7). Population is expressed in units of 10,000 residents purely to keep the resulting numbers small and readable (revised 2026-09-29) — dividing every NTA's weight by the same constant changes nothing about the ranking, only how large the numbers look.

`burden_score` has no standalone real-world unit ("excess minutes × 10,000-person units" isn't dollars or trips) — it is a ranking device only. The rank order is the deliverable, not the magnitude.

## 6. Result (as of this run)

| Stat | Value |
|---|---|
| n | 214 NTAs |
| slope | −3.80 min per unit log(density) |
| r | −0.64 |
| r² | 0.41 |
| p-value | 3.3e-26 |

**Read carefully**: the correlation is negative and significant — denser NTAs are, on average, associated with *shorter* travel time (better access). Density explains a real, moderate share of the variance — this is a stronger relationship than population alone showed (r²=0.23), so the "surprising, no relationship" framing is weaker here than it was for population; what's still true, and should be the framing used on the statement page:

- Density explains only 41% of the variance in soccer access citywide — the majority (59%) of what determines access has nothing to do with how dense a neighborhood is.
- The top-ranked NTAs by burden score (§8) include several of the city's larger neighborhoods (90,000–100,000 residents: Forest Hills, Borough Park, Elmhurst) with access far worse than equally-dense NTAs typically get — concrete counterexamples, even controlling for density.

## 7. Why not travel_time ÷ population?

Considered and rejected. `travel_time_soccer` is already a per-person (intensive) quantity — every resident of an NTA is assumed to face approximately the same travel time. Dividing it by population again is a category error (comparable to dividing life expectancy by population): it produces a number that shrinks as population grows for any fixed travel time, which would dilute exactly the large, underserved NTAs this analysis is meant to surface, and its "low score = lacking infrastructure" framing does not follow from the arithmetic.

## 8. Output

`data/processed/soccer_access_burden_top20.csv` — the top 20 NTAs by `burden_score`, columns: `rank`, `NTA2020`, `NTAName`, `total_population`, `density`, `travel_time_soccer`, `predicted_travel_time`, `residual`, `burden_score`.

## 9. Known Limitations

- **This changes the claim being tested, not just the fit.** The article's original framing was specifically about *population* ("more population doesn't mean better access"). Using density as the regression predictor (§3) tests a related but distinct claim ("denser neighborhoods don't necessarily have better access") — a defensible, arguably stronger framing (it preempts "well of course bigger places have worse access, they're just less dense" by controlling for exactly that), but it is a different sentence than the one originally agreed on, and the statement page's copy should be written to match whichever claim is actually being shown. Per project owner instruction, 2026-09-29.
- **Confound, not caveat**: several top-ranked NTAs (Staten Island's south shore, the Rockaways, eastern Bronx/Queens) are peripheral, transit-poor parts of the city. The regression cannot distinguish "underserved despite density" from "underserved because peripheral, and low density is part of why" — both are true simultaneously. The statement page should frame the flagged NTAs around transit/geographic peripherality, not imply an unexplained anomaly.
- **Log-linear functional form assumed.** A different curve shape (e.g. a threshold effect, or diminishing returns above some density) is not tested; the reported r²/slope are specific to this fit.
- **Area (and therefore density) is computed from each NTA's full polygon**, including any non-residential land within it (parks, water, industrial zones) — an NTA that's mostly parkland with a small residential pocket will read as less dense than its actual inhabited area, understating density for those NTAs specifically.
- **Excludes NTAs with zero recorded population** (48 fewer than the full 262 in METHODOLOGY.md's NTA count once combined with the 48 NTAs already unreachable for every sport type — some overlap between the two exclusion sets is expected but not separately verified here).
- **`burden_score` magnitude is not independently meaningful** (§5) — only the ranking should be used or cited, not the raw numbers.
- Inherits all upstream limitations from §11 of METHODOLOGY.md (single reference date, ACS 5-year rolling estimates, soccer-facility definition).

## 10. Dashboard presentation (live map, all 21 sport types)

`compute_soccer_access_burden.py` above is the standalone soccer-only script backing this document; the same computation is generalized to every one of the 21 `SPORT_TYPE_GROUPS` sport types by `export_dashboard_data.py`'s `export_burden_index()` and shown on the live dashboard's map (replacing raw travel time there). The coloring/legend convention described here (implemented in `frontend/lib/colorScale.ts`) applies identically across all 21 sports, not just soccer — current as of 2026-09-29.

**Bins**: 5 color bands, computed per sport from that sport's own positive `burden_index` values only (`positiveQuantileBinEdges`) — equal-count quintiles, so each band covers 20% of the underserved (positive-score) NTAs. NTAs at or below 0 are not spread across the gradient; they share the exact same color as the bottom band, since a zero-or-negative score means "not part of the underserved story" (§5, §7), not "a slightly milder version of it."

**Colors**: the same light-to-dark blue ramp used by the demographics map (`BIN_COLORS` in `colorScale.ts`, reused directly, not copied) — `#bdd7e7` (≤0 and 0–20th percentile) → `#6baed6` (20–40th) → `#3182bd` (40–60th) → `#08519c` (60–80th) → `#08306b` (80–100th). An earlier green-to-dark-red version was tried and reverted (revised 2026-10-02).

**Legend labels**: "Nth percentile" (20th/40th/60th/80th/100th) — the band's upper cutoff among that sport's positive-scored NTAs, not a value range and not a raw number.

**Tooltip**: shows the exact raw `burden_index` value (one decimal place), not the percentile band — e.g. "Soccer access burden index: 144.5". The map's color communicates rank; the tooltip gives the precise (if not independently meaningful, §5) number for anyone who wants it.

An equal-WIDTH alternative (5 even divisions of `[0, max]` instead of equal-count quantiles) was prototyped for soccer only and reverted after review — quantile bins are what's live for every sport, including soccer.
