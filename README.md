# Earthquake Explorer — USGS M4.5+ earthquakes, 1990–2025

Financial Data Analytics · Data Website Project · by Mason Upton

A two-page static website built around **224,699 earthquakes of magnitude 4.5+** (36 years, 389 countries/regions, 21 columns):

- **Report** (`docs/index.html`) — title, byline, summary, headline numbers, 8 findings (each with numbers and a chart) and a closing section on the data and every calculation.
- **Dashboard** (`docs/dashboard.html`) — loads the data in the browser: 7 filters (years, country/region, macro-region, magnitude class, depth class, magnitude type, tsunami flag), 6 summary numbers, a measure switch (6), a breakdown switch (5), an animated world map, four more charts, a table (events or summary-by-breakdown) and a reset button.

**Live site:** _add the GitHub Pages URL here_

## Where the data came from
U.S. Geological Survey (USGS) ComCat earthquake catalog, FDSN event web service:
`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=4.5&starttime=YYYY-01-01&endtime=(YYYY+1)-01-01` for each year 1990–2025 (public domain), pulled 2026-09-30.
Country outlines and continents: [Natural Earth](https://www.naturalearthdata.com) (public domain); world map shapes: `world-atlas` (Natural Earth, via npm).
One row = one earthquake; time column = `time_utc` (analysed by year), group column = `country_region`.

## Every file and what it does
```
README.md                         this file
requirements.txt                  Python packages used by the scripts
.gitignore                        keeps the 155 MB raw download out of the repo

scripts/
  01_fetch_usgs.py                downloads one USGS GeoJSON file per year (checks each file against the API's own count) and the Natural Earth lookups
  02_build_dataset.py             removes non-earthquakes, derives country_region / macro_region / classes / energy -> data/processed/earthquakes.csv
  03_report_stats.py              computes every number on the report page -> data/processed/report_stats.json and group_table.csv
  04_export_web_data.py           writes the compact files the website loads -> docs/data/
  05_validate_web.py              checks the website's JavaScript against pandas on 8 filter combinations (needs Node.js)
tests/
  web_aggregates.js               Node helper used by 05_validate_web.py (runs docs/js/data.js on docs/data/quakes.bin)

data/
  lookup/ne_50m_admin_0_countries.geojson        Natural Earth countries (for macro-region and fallback grouping)
  lookup/ne_50m_geography_marine_polys.geojson   Natural Earth ocean basins
  processed/earthquakes.csv       the final dataset: 224,699 rows x 21 columns
  processed/group_table.csv       the 61 regions with 500+ events (events, shares, depth, ranks)
  processed/report_stats.json     every statistic quoted in the report
  processed/build_info.json       row counts at each cleaning step and pull date
  raw/                            (not committed) per-year USGS downloads created by 01_fetch_usgs.py

docs/                             the website (GitHub Pages serves this folder)
  index.html                      report page
  dashboard.html                  dashboard page
  css/style.css                   shared styles for both pages
  js/data.js                      loads the data; filtering, aggregation, summary maths (shared by both pages)
  js/map.js                       canvas world map with timeline animation, zoom, hover tooltip and click-to-pin event card
  js/info.js                      small "i" help tooltips for technical terms (dashboard)
  js/report.js                    report page: fills numbers from report_stats.json, draws the 8 findings' charts
  js/dashboard.js                 dashboard: filters, switches, animated summary numbers, did-you-know strip, charts, largest-earthquakes list, table
  data/quakes.bin                 the earthquake table in compact binary form (read by the browser)
  data/meta.json                  column layout and category names for quakes.bin
  data/details.json               place text, USGS event ids and full region names (loaded after the page is interactive)
  data/report_stats.json          numbers for the report page
  data/world-110m.json            world map shapes
  vendor/                         ECharts, D3 and topojson-client libraries (so no CDN is needed)
  .nojekyll                       tells GitHub Pages to serve the folder as-is
```

## Rebuild the data
```
pip install -r requirements.txt
python scripts/01_fetch_usgs.py
python scripts/02_build_dataset.py
python scripts/03_report_stats.py
python scripts/04_export_web_data.py
python scripts/05_validate_web.py
```
Run the site locally (the pages load data with `fetch`, so open them through a server, not by double-clicking):
`cd docs && python -m http.server 8000` → http://localhost:8000

## Publish
GitHub → Settings → Pages → Source: *Deploy from a branch* → branch `main`, folder `/docs`.

## Caveats (also on the site)
- The USGS tsunami field is a flag for whether an earthquake *may have generated* a tsunami, not a measured tsunami, and is only populated from 2013.
- About 46% of depths are USGS default values (10, 33, 35 km).
- Country/region comes from USGS place text (not official borders); macro-region comes from Natural Earth.
- Energy is derived from magnitude; magnitude types (mb vs Mw) are mixed; catalog changes affect counts before ~2004.
