# Ghar Wapsi (working name) — Build Plan v2

*India's festival homecoming, animated. Every train home, on one map.*
Plan date: 2026-10-17 · Launch: 2026-10-26 · Diwali Nov 8 · Chhath Nov 13–16
v2 = v1 plus an independent review that tested every claim against the raw data.

---

## 1. Product

Open the link. Within 3 seconds a dark map of India fills with glowing trains crossing
one night, with a clock and one line of legend: **"Each light is a train · 24 hours in
60 seconds"**. Tap **Festival** and the verified 2026 Diwali/Chhath specials arc across
in gold toward Bihar, UP, Bengal, Odisha and Assam. Tap **Make your card**, pick where
you live and your home state/district, and get a phone-sized image to share.

Lead city: **Bengaluru** — camera preset, Bengaluru-first cards, first launch wave.

### Card content (layout only — every value below is a placeholder, not data)
```
BENGALURU  →  SIWAN, BIHAR
~<km> km  ·  fastest scheduled train ~<h> h          (2016 timetable, sum of segments)
<n> verified festival specials on this corridor       (official notices, as of <date>)
<x> lakh people from Bihar live in Bengaluru district (Census 2011, all reasons)
gharwapsi.in · © OpenStreetMap contributors
```
Fallbacks: no direct train → "Change at <junction>"; no junction found → "No direct
train in the 2016 timetable"; no special → "No verified special yet — check NTES";
no Census figure → line omitted. Card numbers come only from sourced fields (unit test).

### Success criteria by Nov 16
25,000 visitors · 3,000 cards · 300 GitHub stars · ≥1 press/data-journalist mention.

## 2. Scope

**In:** night map (looping 24 h), festival mode, migration shading (state level),
Bengaluru view, card generator (EN + HI UI), methods page, film mode for the video.
**Out:** live positions, availability/"sold out", passenger volumes, fares, booking,
predictions, buses/flights, real track geometry, accounts, servers, Hindi place names
(UI text is bilingual; place names stay Latin in v1).

## 3. Data — verified 2026-10-17

| Source | Facts found | How we use it |
|---|---|---|
| datameet/railways, CC0, **last updated Aug 2016** | 5,208 trains, 8,697 geocoded stations, 417k stop rows, 99.4% stops geocoded. 51% of stations lack a state. 641 trains have `day = null` (476 of them ≥ 500 km). 2,471 zero/negative time segments. 925 trains have a > 200 km/h segment. Longest span 295 h. No running days. Straight-line paths. | Night animation after repair (§4.1) |
| OpenStreetMap, ODbL | 8,364 stations with `ref` code; SMVB, SBC, DNR, PNBE, SV, HWH, ANVT, UDN present | Fill missing/new stations. Published as a separate ODbL file with attribution |
| Census 2011 D-02 | Rows = destination district × origin **state** (not district). Delhi ← Bihar = 11,06,629. One file per state; no Telangana/Ladakh (2011 boundaries). All migration reasons. | State-level shading + card line, labelled "Census 2011, all reasons" |
| datameet/maps, MIT | `india-soi.geojson` Survey of India boundary, States, Districts | Base map, state lookup (point-in-polygon) |
| 2026 specials | No 2026 PIB release found; aggregators disagree (100+ entries vs 6,000 vs 8,454 trips) | Hand-curated from official zonal notices only; aggregator-only rows excluded |

### Data rules
1. A special needs an official source URL and `verified_on` date, or it is excluded.
2. Specials are drawn as origin→destination arcs using endpoint times only (no
   intermediate stops), so curation is ~10 min per train, not hours.
3. Every headline count is computed from our verified rows and says so; never copied
   from press.
4. "2016 timetable snapshot · weekly trains shown as daily" sits next to the clock,
   not only on the methods page. 20 major trains spot-checked against NTES; dead ones dropped.

## 4. Engineering

### 4.1 Pipeline (Python, run locally; outputs committed)
1. Merge stations: datameet + OSM by station code; assign state by point-in-polygon
   (SoI states); report unmatched codes.
2. Repair schedules per train: infer `day` by incrementing whenever clock time goes
   backwards; spread same-minute stops evenly across the next real gap so timestamps
   strictly increase; drop trains with impossible spans (> 120 h) and log them.
3. Speed check: report segments > 200 km/h, allow-list known fast trains, drop only
   segments that are clearly geocoding errors (> 400 km/h). Report, never silently fix.
4. Loop copies: each trip emitted at offsets 0, −1440, −2880 … min until it no longer
   overlaps the [1440, 2880) window; the app animates `currentTime` over that window.
5. Pack: positions quantised to Uint16 over India's bounding box, minutes as Uint16.
   Two files — `trains-long.bin` (≥ 500 km, first view) and `trains-rest.bin` (lazy).
   Target ≤ 1.2 MB for the first file. A poster image shows until data is ready.
6. Census: try the all-India D-02/D-03 file first; else download state files manually
   (half a day budgeted). Produce `migration_state_matrix.json` and
   `migration_district_by_origin_state.json`; totals asserted against Census all-India.
7. Routes: card "from" cities (fixed list of ~25 metros, each with a Census district
   code and a station cluster) × home district (centroid → nearest station served by
   long-distance trains). Route = direct train, else one change at a junction.
   Distance = sum of segment straight lines, labelled as approximate.
8. Every run prints a stats report; the report is committed so changes are reviewable.

### 4.2 Web app (Vite + TypeScript + deck.gl)
- Layers: SoI state polygons (migration shading), TripsLayer (trains, trails),
  ArcLayer/animated arcs (specials), small station points on zoom.
- No basemap tiles, no API keys.
- Low-end device path: fewer trails, lower trail length, auto-detected by frame time.
- `prefers-reduced-motion`: static frame + text summary; animation only on request.
- Fonts: full Noto Sans Devanagari woff2 (layout features intact), awaited with
  `document.fonts.load` before any canvas drawing.
- Card: drawn on canvas, blob pre-rendered when the route is chosen. Share button calls
  `navigator.share({files})` only if `canShare` passes; else download; in Instagram/
  Facebook in-app browsers, show "long-press to save".
- Analytics: GoatCounter (no cookies) — page views and a "card created" event.
- Hosting: GitHub Pages via Actions. Custom domain if approved (open question).

### 4.3 Licences
Code MIT. Derived train data CC0 (from datameet). Station file containing OSM data
ODbL, separate file. Attribution "© OpenStreetMap contributors · Census of India 2011 ·
DataMeet · Survey of India boundary" on the map footer, methods page and card.

## 5. Quality bar

| Area | Target | Check |
|---|---|---|
| First view | Poster < 1.5 s, animation < 3.5 s on throttled 4G | DevTools throttling |
| Frame rate | ≥ 30 fps on a mid-range Android, 60 fps desktop | Real phone + perf overlay |
| Data | Pipeline report clean; no unexplained drops; Census totals match | Assertions in pipeline tests |
| Honesty | Card lines only from sourced fields | Unit test |
| Accessibility | WCAG 2.2 AA: keyboard, visible focus, reduced motion, text summary, card alt text | axe-core in CI + manual keyboard pass |
| Mobile | 360 px width, no horizontal scroll; iOS Safari + Android Chrome + Instagram in-app browser | Manual matrix |
| CI | Pipeline tests, card snapshot tests (10 routes, EN + HI), Playwright smoke | GitHub Actions |

## 6. Schedule (each day ends with a passing check)

| Day | Work | Exit check |
|---|---|---|
| Oct 18 | Name decided. Repo. Pipeline steps 1–5 | Stats report reviewed; first-view file ≤ 1.2 MB |
| Oct 19 | Map + TripsLayer loop, clock, legend, mobile layout, low-end path | 60 fps desktop, ≥ 30 fps throttled; screenshot |
| Oct 20 | Specials curation (Bengaluru routes first) + festival arcs | ≥ 15 verified specials, ≥ 3 from Bengaluru |
| Oct 21 | Census download + matrix, route builder (pipeline steps 6–7) | Totals match; 25 cities × all districts resolve to a route or a stated fallback |
| Oct 22 | Card generator EN + HI, share flows, Bengaluru view | 10 snapshot cards correct; share tested on Android, iOS, Instagram in-app |
| Oct 23 | Methods page, accessibility, performance, film mode, video render (16:9 + 9:16) | axe clean; two MP4s 20–30 s |
| Oct 24 | Real-world test with 5 people on their own phones (2 non-tech) | Issue list written |
| Oct 25 | Fix list, README + GIF, OG images, launch copy per channel; specials top-up | Every launch asset reviewed |
| Oct 26 | Launch: Bengaluru wave → national → HN / r/dataisbeautiful | — |
| Oct 27 → Nov 16 | Daily specials refresh, error reports, Diwali + Chhath follow-ups | — |

Daily specials curation continues in parallel with Oct 21–25 work (≥ 40 by launch).

## 7. Risks

| Risk | Mitigation |
|---|---|
| Name "Ghar Wapsi" read as the religious reconversion campaign | Decide on Oct 18 before any domain, OG image or video (open question) |
| 2016 timetable called stale | Labelled beside the clock; dead trains dropped; festival layer is 2026-only |
| Specials wrong / list changes | Official sources only, dated rows, daily refresh, public error link |
| Census misread as festival travellers | Wording "live in", "all reasons", 2011 boundaries note |
| Map boundary controversy | Survey of India boundary |
| Share fails in in-app browsers | Capability detection + save fallback, tested |
| Weak launch | Bengaluru-first wave, video ready before launch, journalist list, festival follow-ups |

## 8. Decisions needed from the owner
Answered 2026-10-17:
1. Name: **Ghar Wapsi** — kept; owner accepts the connotation risk.
2. Domain: `aftabbs.github.io/ghar-wapsi` for now; `.in` domain later.
3. Launch accounts and posting: planned in a later phase, once the demo stage is ready.
4. Five testers on Oct 24: agreed (owner arranges).
5. GoatCounter: account created; site code `aftab` (https://aftab.goatcounter.com/count).
6. Repo: public, `Aftabbs/ghar-wapsi`, MIT.
