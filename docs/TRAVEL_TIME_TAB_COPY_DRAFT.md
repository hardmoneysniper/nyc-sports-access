# Travel Time tab — proposed description copy (not yet applied)

Drafted 2026-10-16 as a plain-language expansion of the Travel Time tab's
description paragraph (`frontend/components/methodology/TravelTimeTab.tsx`),
adding detail on how each tract's starting point is computed and how travel
times themselves are computed, with the tools named — pulled from
[`docs/METHODOLOGY.md`](METHODOLOGY.md) §6 and written for a non-technical
reader. **Not applied to the site** — the project owner wants to keep the
current page copy as-is for now and hold this version in reserve here
instead.

Glossary terms that are underlined on the live page are marked below with
`__double underscores__`; the MTA developer link is marked with
`[link text](url)`.

---

Residents at opposite ends of a neighborhood can have very different trips,
so a single starting point cannot represent everyone's access. Each
__Neighborhood Tabulation Area (NTA)__ is made up of smaller geographic areas
called __census tracts__. For each tract, we pick a starting point using a
mapping tool called Shapely: rather than a plain geometric center, which can
accidentally land outside an oddly shaped tract (think a C- or L-shaped
block), it guarantees a point that actually falls inside the tract's own
boundary. We then calculate the travel time from that point to the nearest
public sports facility using R5, an open-source transit-routing engine. R5
simulates the real trip step by step — walking to a bus stop or subway
station, waiting based on its actual published schedule, riding it, and
walking the rest of the way — using NYC's real
[subway, bus, and ferry schedules](https://www.mta.info/developers) together
with the real street and path network mapped by OpenStreetMap, rather than
estimating distance as the crow flies. We then take a __population__-weighted
average for the NTA, giving more weight to tracts with more residents.

---

## What changed vs. the live copy

- "We use each tract's midpoint as the starting point" → replaced with an
  explanation of how that point is actually computed (Shapely, a
  guaranteed-inside-the-shape point, not a literal geometric midpoint) and
  why that matters (oddly shaped tracts).
- Named the routing engine (R5) and broke "simulates real trips" out into
  the concrete step-by-step sequence (walk → wait on the real schedule →
  ride → walk).
- Kept the MTA developer hyperlink, moved onto "subway, bus, and ferry
  schedules" instead of "real transit schedules" (same destination URL).

## Rationale behind each choice

Why the methodology works this way, in plain language, with a pointer to
where each reason comes from in [`docs/METHODOLOGY.md`](METHODOLOGY.md) (M)
or the [original pipeline design spec](superpowers/specs/2026-08-29-transit-accessibility-data-pipeline-design.md)
(S). None of this is proposed as website copy — it's the "why" behind the
paragraph above, kept here for reference.

1. **Calculating per census tract, not one point per neighborhood.**
   A neighborhood (NTA) can be large enough that residents on opposite
   sides of it face very different trips to the same facility. Breaking
   the calculation down into census tracts — there are 2,325 of them
   citywide, versus 262 neighborhoods — keeps each starting point local
   enough that it isn't quietly averaging together two very different
   real experiences. (M §1, §6)

2. **Using a guaranteed-inside point (Shapely), not a plain geometric
   center.** A plain mathematical center of a shape can land *outside*
   that shape if it isn't simply convex — think a tract shaped like a C
   or an L, or one wrapped around a park. Starting a route from a point
   outside the tract's own boundary would distort the result on its own,
   so the pipeline deliberately uses a point Shapely guarantees sits
   inside the tract instead. (M §6, S §4)

3. **Adding a small "walk to the starting point" time buffer.** No single
   point can stand in for exactly where every resident of a tract begins
   their trip. To account for that, the pipeline measures how far someone
   at a representative far corner of the tract would need to walk just to
   reach the computed starting point, converts that distance to time at
   an average walking pace (3 miles per hour), and adds it to every trip
   that starts from that tract — so the "one point per tract"
   simplification doesn't quietly understate how far someone actually has
   to walk before their trip even begins. (M §6, S §4)

4. **Using R5, a dedicated transit-routing engine, instead of a simpler
   distance estimate.** R5 (built by Conveyal) was picked specifically
   because it can compute travel times between thousands of starting
   points and thousands of destinations at once ("many-to-many"), which
   is exactly what's needed to cover every census tract against every
   sports facility, for every sport, for every time-of-day window, without
   the computation becoming impractically slow. It was chosen over a
   similar tool (OpenTripPlanner) for this reason. (S §4)

5. **Using real, scheduled transit departures, not an assumed average
   frequency.** Rather than assuming a bus or train "comes every X
   minutes" on average, the pipeline reads each line's actual published
   timetable for a specific representative date and time window and uses
   the median wait across many real departures in that window. That
   captures real unevenness in service — some lines run every 4 minutes,
   others every 20 — instead of flattening every route to one generic
   assumption. (M §6)

6. **Using the real street and path network (OpenStreetMap), not a
   straight line.** A straight-line ("as the crow flies") distance ignores
   how people actually have to move through a city: around buildings and
   parks, across bridges, along the sidewalks and streets that actually
   exist. Routing over the real network means the walking portions of a
   trip reflect a path someone could actually walk, not a line that might
   cut through a building or a body of water. (M §6)

7. **Taking the time to the *nearest* facility of that sport, not an
   average across all of them.** Someone who wants to play a sport goes to
   whichever facility gets them there fastest, not some blend of every
   facility in the city. Taking the minimum across facilities answers the
   real question — "how long would it realistically take this resident to
   reach a usable facility" — rather than a number no one would actually
   experience. (M §6)

8. **Weighting the neighborhood-level number by population, not averaging
   tracts evenly.** A neighborhood's tracts don't all have the same number
   of residents. If every tract counted equally regardless of population,
   a nearly-empty tract could pull the neighborhood's reported number just
   as much as a tract where thousands of people actually live. Weighting
   by population means the final number better reflects the experience of
   where people actually live, not the geography itself. (M §7)
