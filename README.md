# Accessibility Atlas — Hyderabad

What can you reach on foot, and what is the walk like? Live at
**https://hyderabad.urbanobservatory.in/access/** (GitHub Pages, deploy = push to `main`).
The old address `access.hyderabad.urbanobservatory.in` is held by the redirect repo `to-access`.

Fully static, no build step. Every index is precomputed on an H3 grid (resolution 10, ~65 m)
by the pipeline in `observatory-work/accessibility/scripts/` and served as PMTiles + small JSON.

## Where things live

| Piece | Where |
|---|---|
| App (this repo) | `index.html`, `report.html`, `report-area.html`, `config.js`, `css/`, `js/`, `vendor/`, `assets/` |
| Data, ~980 MB | obs-mumbai `/srv/obs/www/access/` → `https://api.urbanobservatory.in/access/` (`endpoints.json` + `data/`) |
| nginx for the data | `observatory-work/server/api/nginx-obs-api.conf`, `location /access/` |
| Pipeline | `observatory-work/accessibility/scripts/` (01–07, `98_validate.py`) |

`config.js` → `DATA_URL` is the server on the live site and `/_data` on localhost.
`endpoints.json` (written by `06d_endpoints.py`) is the only place the app learns data paths.

## Local

```bash
python3 dev-server.py            # http://127.0.0.1:8126/, launch entry `access`
python3 dev-server.py --data <folder with endpoints.json + data/>
```

## Updating the data

From the folder holding `endpoints.json` and `data/` (one SSH connection; port 22 is rate-limited):

```bash
rsync -aL --partial endpoints.json data obs@13.140.59.105:/srv/obs/www/access/
ssh obs@13.140.59.105 'cd /srv/obs/www/access && find . \( -name "*.json" -o -name "*.geojson" \) -newer endpoints.json.gz -exec gzip -kf9 {} +'
```

The `.gz` copies sit beside each JSON file and nginx serves them (`gzip_static`).

## History

Built by Teja in 2026 and run by Amruth on his server until Nov 2026, from
`amruthkiran94/hyderabad-urban-observatory` (`accessibility atlas/`). This repo starts from that
code as it was live, plus the Share fix of 29 Oct (links keep the Street, City or Transit tab).
Analytics changed from Umami to the observatory's visit counter (`visits.js`, no cookies, no IPs).
