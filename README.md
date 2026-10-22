# Native Place

**Going to native? Find your train.** Type where you live and your native place. Native Place
gives the fastest train in the official 2026 timetable, an estimated fare range, any special
trains running this season, and how many people make the same trip, with a source next to
every figure.

**Live:** [native-place.pages.dev](https://native-place.pages.dev/) (mirror: [aftabbs.github.io/native-place](https://aftabbs.github.io/native-place/))

<p>
  <img src="docs/screenshot-laptop.png" alt="The search panel showing Bengaluru to Patna: the fastest direct train, fares and special trains, with the route lit in gold on a dark map of India" width="68%">
  <img src="docs/card-example.png" alt="A shareable card for Bengaluru to Patna with the train, fare range, special trains and Census figures, each with its source" width="28%">
</p>

## What it does

- **Any place to any place.** Search any of India's 640 districts under the names people
  use today (Gurugram, Prayagraj, Leh in Ladakh) or any of 867 timetable stations. Old names
  such as Bangalore, Gurgaon or Calcutta work too.
- **The train.** The fastest direct train, its times, days and journey length. With no direct
  train, the quickest trip with one change (in the same station or across town). Where a place
  has no station in the timetable, the nearest useful one and how far away it is; Ladakh,
  Lakshadweep and the Andaman Islands are named as having no railway yet.
- **The fare.** A range per class, estimated from the official fare tables for the part of the
  trip you ride.
- **Special trains this season.** Shown only while they run, each linked to its official notice.
  Now: Diwali and Chhath 2026. Each holiday rush adds its own.
- **You are not alone.** The share of long-distance train trips between the two states (2023)
  and how many people from home live where you do (Census 2011).
- **A card to share** with every line sourced, and a link that opens the same answer. Shared
  links show a preview image on WhatsApp and social apps.
- **The map.** Every train in the timetable moving across one day in 60 seconds; your route
  lights up and the rest dims. Explore mode adds satellite imagery and tap-for-details panels
  for trains, stations, districts and states.

## Data

| What | Source | Date |
|---|---|---|
| Train timings | [Trains at a Glance](https://indianrailways.gov.in/railwayboard/view_section.jsp?lang=0&id=0,1,304,366,537,3143), Ministry of Railways (Railway Board) | Effective 1 Jan 2026 |
| Special trains (Diwali and Chhath 2026) | Zonal railway press releases on `*.indianrailways.gov.in` | Checked 17 Oct 2026 |
| Rail travel between states | [EAC-PM, *400 Million Dreams*](https://eacpm.gov.in/wp-content/uploads/2024/12/FINAL-Internal-Migration-Project.docx-Publication-Version.pdf), Table 7 | 2023 |
| People living in another state | Census of India, Table D-02 | 2011, the latest count |
| Fares (estimates) | Trains at a Glance 2026 fare tables + Commercial Circular 24/2025 | w.e.f. 1 Jul 2025, revised 26 Dec 2025 |
| Satellite imagery | [Sentinel-2 cloudless 2024](https://cloudless.eox.at) by EOX, CC BY-NC-SA 4.0 | 2024 |
| Station locations | [DataMeet](https://github.com/datameet/railways) + [OpenStreetMap](https://www.openstreetmap.org/copyright) | OSM Oct 2026 |
| Boundaries | Survey of India outline via [DataMeet maps](https://github.com/datameet/maps) | — |

Census 2027 migration tables are not yet published; the answer shows the 2011 count with its
date beside the 2023 rail-travel figure. The [methods page](https://native-place.pages.dev/methods.html)
explains every check and limit.

### How the timetable is checked

Trains at a Glance is published as 97 PDF tables. The pipeline reads every table, joins each
train across tables, matches station names to codes, and drops any train whose times run
backwards or whose speed is impossible. Of 3,576 trains in the timetable, 2,626 pass. For the
596 that start and end at the same stations in an independent 2016 timetable, the median
journey-time ratio is 0.99 and 97.8% are within 25%. Every count is in
[`pipeline/report.json`](pipeline/report.json).

## Run it locally

Requires Python 3.10+ and Node 22+.

```bash
# data pipeline (downloads about 250 MB of sources into data/raw)
python -m pip install -e ".[dev]"
cd pipeline
python -m ghar.fetch          # DataMeet, OpenStreetMap, Census 2011 tables
python -m ghar.tag_extract    # Trains at a Glance 2026 PDFs -> table cells (about 6 minutes)
python -m ghar.build          # writes web/public/data and pipeline/report.json
```

```bash
# web app
cd web
npm ci
npm run dev                   # http://localhost:5173
```

The built data is committed, so the web app runs without the pipeline.

## Project layout

| Path | What it does |
|---|---|
| `pipeline/ghar/tag_extract.py` | Downloads Trains at a Glance 2026 and extracts every table |
| `pipeline/ghar/tag.py` | Reads train columns, joins tables, matches stations, validates |
| `pipeline/ghar/stations.py` | Merges DataMeet and OpenStreetMap stations, assigns districts |
| `pipeline/ghar/specials.py` | Validates the hand-transcribed special trains |
| `pipeline/ghar/census.py`, `eacpm.py` | Census 2011 D-02 and EAC-PM 2023 tables |
| `pipeline/ghar/places.py` | Districts under today's names and states, with old names as aliases |
| `pipeline/ghar/pack.py` | Packs trips into a compact binary for the browser |
| `data/specials/` | Special trains by season, one official source link per train |
| `web/src/journey.ts`, `answer.ts` | Finding the train (direct, one change, nearest station) and the answer |
| `web/` | The map (deck.gl), search, card and methods page |
| `tests/`, `web/src/*.test.ts`, `web/e2e/` | Pipeline, unit, browser and accessibility tests |

## Tests

```bash
python -m pytest                      # pipeline (real-data tests run when data/raw exists)
cd web && npx vitest run              # search, journeys, fares and decoder logic
cd web && npm run build && npx playwright test   # browser flow and WCAG 2.2 AA checks
```

## Found a mistake?

[Open an issue](https://github.com/Aftabbs/native-place/issues) with the train number or district
and the source that shows the right value. Always confirm a journey on NTES or IRCTC before you
travel.

## Licences

Code: [MIT](LICENSE). Data: see [web/public/data/LICENSES.md](web/public/data/LICENSES.md).
