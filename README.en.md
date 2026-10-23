<div align="center">

# Xiá · Global Glow Forecast

**Sunrise and sunset glow predictions for anywhere on Earth, built on atmospheric optics and live numerical weather data.**

[![Live Demo](https://img.shields.io/badge/live%20demo-glow.nybbq.art-FF6A2C?style=flat-square)](https://glow.nybbq.art/) [![License: MIT](https://img.shields.io/badge/license-MIT-2EA44F?style=flat-square)](LICENSE) [![Vanilla JS](https://img.shields.io/badge/stack-vanilla%20JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript) [![No build](https://img.shields.io/badge/build-none-3FA66A?style=flat-square)](#quick-start) [![Data](https://img.shields.io/badge/data-Open--Meteo%20%2B%20CAMS-4C8BF5?style=flat-square)](https://open-meteo.com/)

[简体中文](README.md) · **English**

<a href="https://glow.nybbq.art/"><img src="docs/assets/hero.jpg" alt="Xiá · Global Glow Forecast" width="100%"></a>

<sub>Mexico City · tonight's sunset glow, 87 / 100 (Major) · screenshot from the live site</sub>

</div>

---

Xiá (霞) is the Chinese word for the colored sky at dawn and dusk. This project predicts it.

Type a city and the site returns four forecasts — today's sunrise, tonight's sunset, tomorrow's sunrise, tomorrow's sunset — each with a six-level grade, a 0–100 Glow Score, clarity, model agreement, confidence, the best viewing window, and a one-line reason.

Most weather apps stop at cloud cover. But a glowing sky needs three things to be true at once:

1. **Curtain** — enough mid- and high-level cloud. With no cloud, there is nothing for the light to catch.
2. **Gap** — clear sky upstream, along the sun's bearing, so low cloud does not block the light skimming the horizon.
3. **Low-cloud floor** — the low cloud in view must stay thin, or the horizon itself gets washed out.

The score combines those three as a **weighted geometric mean**: if any one of them approaches zero, the Glow Score approaches zero. Precipitation, aerosols, visibility, PM2.5, dew-point spread, wind and convection only modulate the result by ×0.7–1.0. That is the main difference from additive "cloud index" models — a cloudless sky never scores as a moderate glow.

The site is fully static: no backend, no database, no build step. Every calculation runs in the browser. The server does two things only — serve the files, and generate the daily rankings JSON.

## Features

### Forecast

| Capability | What it does |
|---|---|
| **Four events** | Today and tomorrow, sunrise and sunset side by side. Selecting one updates the sky, timeline and profile together. |
| **Verdict first** | A plain-language call ("basically nothing" / "a little · Minor" / "yes · Major") and an action hint before any numbers. |
| **Multi-model ensemble** | Cloud cover from best_match, ECMWF IFS, GFS and ICON; each model is scored, then combined with a weighted average (best_match ×3). |
| **Confidence** | High / medium / low based on how tightly the models agree, not just on distance from a grade boundary. |
| **Clarity 1–7** | AOD, visibility, PM2.5 and dew-point spread scored separately from cloud conditions. |
| **Auditable** | All 11 factors, their weights, model disagreement and the underlying science sit behind "Why this call?". |

### Interface

- **The sky is the interface.** The hero sky, cloud-base lighting, sun and water reflection are all driven by the selected event's score. Cloud decks are generated from SVG fractal noise and bottom-up diffuse lighting on a perspective plane.
- **Twilight timeline.** ±2.5 hours around the selected event, draggable or auto-playing, split by true solar elevation into daylight, golden hour, glow, blue hour, nautical dusk and night.
- **Atmospheric profile.** The 11 factors are stacked by the altitude at which they act; missing data is labelled "no data" rather than interpolated.
- **Empty first screen.** No default city on first visit. One location request on first interaction, GPS first then IP, and a manual choice is never overwritten.
- **Favourites and cache.** Saved places and rankings live in localStorage only.

### Glow Board

Every day at 15:00 Beijing time, the server runs `scripts/build-rankings.js` and scores the next sunset for 36 major world cities and 34 Chinese cities with the exact same algorithm the page uses. The result is a static `data/rankings.json`:

- visitors no longer trigger ~350 API calls each;
- the browser falls back to live computation only if the file is missing or older than 36 hours;
- cities are ranked by Glow Score, ties broken by confidence, with a six-grade distribution and a sunset-terminator map.

### Command line and automation

| Script | Purpose |
|---|---|
| `scripts/daily-push.js` | Text forecast from the same engine: 7 days, calibrated probability, spectral colour, reddest moment, ECMWF ENS-51 spread |
| `scripts/build-rankings.js` | Builds the daily rankings JSON (atomic write) |
| `scripts/verify-rankings.js` | Cross-checks rankings city by city with an independent model, writes verified flags |
| `scripts/daily_snapshot.py` | Appends forecast cloud cover, Glow Score and airport METAR observations to a JSONL dataset |
| `scripts/verify_vs_metar.py` | Forecast cloud cover vs METAR observations |
| `scripts/label.py` / `scripts/eval.py` | Human ground-truth labels, hit-rate / AUC evaluation |

## How it works

### Data flow

A full evaluation of one location makes **three requests** (plus one geocoding call when searching):

1. **Forecast** — the point plus upstream points 50–400 km along the sunrise/sunset bearing, across four models in one call;
2. **Air quality** — CAMS AOD at 550 nm, PM2.5 and PM10;
3. **Ensemble** — multi-point, multi-model cloud cover, used to measure model agreement.

Sunrise and sunset bearings for today and tomorrow differ by less than 0.5°, so upstream points are shared across all four events.

### Glow Score v2.2

```text
key   = curtain^0.50 × gap^0.30 × low_cloud^0.20   # weighted geometric mean, 0–100
air   = weighted mean of precip / AOD / visibility / PM2.5 / dew spread / wind / CAPE
score = key × (0.7 + 0.3 × air / 100) + post-rain bonus (0–5)
```

- Precipitation at glow time caps the score at 34 (Faint).
- The curtain is multiplied by a 0.75–1.0 illumination factor: high cloud is brighter than mid cloud at the same coverage, and higher AOD dims it.
- **Gap v2** counts only upstream low cloud plus 0.5 × mid cloud as blocking. Light that illuminates cloud bases arrives near-horizontally, so cirrus high above does not block it.

### Grades and confidence

| Score | Grade | Meaning |
|---:|---|---|
| 80–100 | Major | Sky-wide colour; worth going out for |
| 65–79 | Moderate–Major | Large areas of glow |
| 50–64 | Minor–Moderate | A good chance of glow |
| 35–49 | Minor | Patches of colour possible |
| 20–34 | Faint | Cloud edges may pick up a little colour |
| 0–19 | None | Not enough cloud to light up |

Confidence comes from model agreement: high when ≥80% of models land within ±1 grade and the spread is ≤30, medium at ≥60%, low otherwise.

### Physical layer (v2.2, push pipeline)

These four layers currently power the daily push and CLI; the website still runs the v2 geometric model:

- **Calibrated probability** — `P = sigmoid(0.0375 × (score − 77.9))`, anchored to historical hit rates for the same score band (50 ≈ 26%, 65 ≈ 38%, 80 ≈ 52%, base rate ≈ 17%).
- **Spectral colour** — CIE 1931 fit with 61 wavelengths (400–700 nm), Rayleigh τ ∝ λ⁻⁴·¹ and aerosol τ ∝ λ⁻¹·³, mapped to gold / amber / orange / crimson / rose.
- **Reddest moment** — cloud-base illumination limits by height (high cloud ≈ −2.9°, mid cloud ≈ −2.3°), solved by bisection on solar elevation to produce a "reddest window".
- **ENS-51** — all 51 ECMWF ensemble members scored at the point, producing a probability distribution.

## Quick start

Requirements: a modern browser. Node.js 18+ and Python 3.9+ are optional, for the scripts.

```bash
git clone https://github.com/baiiiii521/sunset-glow-forecast.git
cd sunset-glow-forecast

# either
open index.html                  # open the file directly
python3 -m http.server 8000      # or serve it statically (recommended)
```

Then open <http://localhost:8000>. There is no `npm install` and no build step.

> The page calls Open-Meteo directly. If a busy network triggers HTTP 429, wait a minute and retry.

## Project layout

```text
.
├── index.html              Page shell and SVG cloud filters
├── styles.css              Styles, design tokens, motion
├── algo.js                 Algorithm layer: pure functions, shared by browser and Node
├── api.js                  Data layer: Open-Meteo requests, place evaluation, batch scoring
├── app.js                  UI layer: rendering, interaction, geolocation, local cache
├── scripts/
│   ├── build-rankings.js   Daily Glow Board → data/rankings.json
│   ├── stamp-assets.js     Content-hash versioning for css/js references
│   ├── daily-push.js       Text forecast and push payload
│   ├── jev.js              Independent model cross-check client
│   ├── verify-rankings.js  City-by-city rankings verification
│   ├── daily_snapshot.py   Forecast + METAR observation dataset
│   ├── verify_vs_metar.py  Cloud-cover observation comparison
│   └── label.py / eval.py  Human labels and evaluation
├── test/
│   ├── parity.js           JS vs Python implementation parity (offline)
│   ├── search.js           Geocoding and duplicate-name resolution (network)
│   └── smoke.js            Full page initialization (network)
├── docs/                   Algorithm comparisons, handoff notes, screenshots
└── data/                   Runtime data, not tracked
```

There is exactly one dependency direction: `app.js → api.js → algo.js`. The algorithm layer never touches the network and the data layer never touches the DOM, so the same `algo.js` and `api.js` run unchanged on the server for the rankings.

## Development and testing

```bash
node test/parity.js                  # offline, must PASS
node test/search.js                  # network
node test/smoke.js                   # network, full page initialization
node scripts/stamp-assets.js --check # verify asset version hashes are current
node scripts/build-rankings.js data/rankings.json
```

After editing `styles.css`, `app.js`, `algo.js` or `api.js`, run `node scripts/stamp-assets.js` before committing so the content hashes in `index.html` are updated.

## Deployment

| Platform | Steps |
|---|---|
| **GitHub Pages** | Settings → Pages → Deploy from a branch → `main` / `(root)` |
| **Vercel** | Import the repo, choose framework preset `Other`, no build command |
| **Netlify** | Publish directory `.`, leave the build command empty |
| **Own server** | Serve the repo root with any static server; add a cron job for the daily `data/rankings.json` |

## Data sources

| Source | Used for | Cost |
|---|---|---|
| [Open-Meteo Forecast](https://open-meteo.com/) | Layered cloud cover, precipitation, visibility, wind, CAPE, sunrise/sunset | Free, no key |
| [Open-Meteo Air Quality](https://open-meteo.com/en/docs/air-quality-api) | CAMS AOD (550 nm), PM2.5, PM10 | Free, no key |
| [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) | City search | Free, no key |
| [Open-Meteo Ensemble](https://open-meteo.com/en/docs/ensemble-api) | ECMWF ENS-51 (push pipeline) | Free, no key |

The free tier allows 600 calls per minute and 10,000 per day; check the official policy for current limits.

## Accuracy and limitations

- This is a **heuristic model built on published literature**, not an official weather forecast. There is no peer-reviewed "sunset colour index".
- The grade thresholds and geometric weights have had one small cross-check: one day, 39 locations, five-model weighting at the time (AUC 0.79 for the evening event). AUC measures rank agreement with an external ranking, not accuracy.
- Ground truth is still accumulating locally (`data/` is not tracked): `glow-dataset.jsonl` logs daily forecasts against METAR observations, and `glow-labels.jsonl` holds human labels. Thresholds and weights will be recalibrated once the sample is large enough.
- When data is missing the page says "no data" instead of interpolating or guessing.
- CAMS is global at roughly 45 km and 3 hours, so local accuracy is limited.
- The glow-intensity curve on the timeline is an illustration (score × a bell-shaped time window), not physical output.
- The Glow Board covers 70 major cities, not districts and counties.
- All queries go out from the browser. No personal data is collected or uploaded; favourites and caches stay in localStorage.

## Roadmap

- Calibrate thresholds, geometric weights and model weights against observations, and add a script that reports AUC and hit rate automatically.
- Cache Open-Meteo behind the server to improve latency and quota for users in mainland China.
- Expand the Glow Board to district level, add a sunrise board, and render a national heatmap.
- Bring the ENS-51 distribution and the physical illumination curve into the web app, replacing the illustrative timeline curve.
- Add `parity` and `stamp-assets --check` to CI.

## Acknowledgements

- Stephen Corfidi, *The Science of Sunsets* (NOAA/NWS)
- SOLA 2013 radiative-transfer simulations
- SkyCandy, SunsetWx and Skyfire for their published heuristics
- [Skyglow](https://github.com/couletian/Skyglow) for the spectral, illumination-geometry and calibration layers
- [Open-Meteo](https://open-meteo.com/) and CAMS for free, keyless data
- The public rankings from the WeChat account "super朝霞晚霞预报", used for cross-checks

## License

[MIT](LICENSE). This project is not affiliated with any official meteorological agency. Forecasts are for observation planning only.
