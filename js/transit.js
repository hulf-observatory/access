// Bus & Metro view: stop -> panel details + walking range + every stop you can
// reach without changing buses, coloured by travel time; route -> line + its
// stops + what is reachable along it.
import { DATA_URL, SERVICE_CLASS, CATEGORY_LABELS, TIER1, TIER2, MODE_COLORS, DISCLAIMER_HTML, inCore } from "../config.js";
import { endpoints, setPin, setFocus, POINTS } from "./map.js";
import { cellForLngLat, getCellEntry, getStopEntry } from "./shards.js";
import { clearReach } from "./stops.js";

let routesIdx = null;
async function getRoutes() {
  if (routesIdx) return routesIdx;
  try {
    routesIdx = await (await fetch(
      `${DATA_URL}/${endpoints.routes || "data/routes.json"}`,
      { cache: "no-cache" })).json();
  } catch { routesIdx = {}; }
  return routesIdx;
}

let classesIdx = null;
async function getTransitClasses() {
  if (classesIdx) return classesIdx;
  try {
    classesIdx = await (await fetch(`${DATA_URL}/data/transit_classes.json`,
      { cache: "no-cache" })).json();
  } catch { classesIdx = {}; }
  return classesIdx;
}

// bus disc opacity per class — mirrors the map's faded minimal/low stops
const CLASS_ALPHA = { frequent: 1, regular: 0.78, low: 0.55, ghost: 0.35 };
const busSwatch = (a) => `rgba(179,38,27,${a})`;
const MMTS_CAVEAT = `<p class="hint caveat">MMTS times are from a 2019 timetable, so treat
  them as a rough guide.</p>`;

// small stop service badge (bus only) for the stop detail panel
function serviceBadge(mode, service_class, trips, peak_only) {
  if (mode !== "bus") return "";
  const sc = SERVICE_CLASS[service_class];
  if (!sc) return "";
  const excluded = service_class === "ghost" || peak_only;
  return `<div class="svc" style="margin-top:4px">
    <span style="display:inline-block;width:9px;height:9px;border-radius:50%;
      background:${busSwatch(CLASS_ALPHA[service_class] || 1)};
      vertical-align:middle;margin-right:5px"></span>
    <b>${sc.label} service</b> · ${trips ?? "?"} buses a day${peak_only
      ? " · <b>rush hour only</b>" : ""}
    ${excluded ? `<div class="note" style="margin-top:2px">Too little service to count
      as public-transport access in the City maps.</div>` : ""}
  </div>`;
}

const body = () => document.getElementById("panel-body");
let lastStop = null;   // the stop card a route card came from (Back)
const MODE_LABEL = { bus: "Bus stop", metro: "Metro station", mmts: "MMTS station" };
const MAX_ROUTE_SHEDS = 60;

// route line weights: light for every route serving a clicked stop, bold for a
// single picked route. Lines are map-matched approximations (see disclaimer).
const ROUTE_LINE_THIN = { w: 1.4, o: 0.6 };
const ROUTE_LINE_SEL = { w: 2.8, o: 0.95 };
const ROUTE_DISCLAIMER = `<p class="hint caveat disclaimer">Experimental: route lines are drawn onto
  the road network automatically and can wander on long routes. The open GTFS timetables behind
  them have gaps and errors of their own.</p>${DISCLAIMER_HTML}`;
// the section's notice, shown every time you enter Bus & Metro (by tab or by
// "Routes from here"); Explore or Escape dismisses it
function showNotice() {
  const n = document.getElementById("transit-notice");
  if (!n) return;
  n.hidden = false;
  n.querySelector("button").onclick = () => { n.hidden = true; };
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { const n = document.getElementById("transit-notice"); if (n) n.hidden = true; }
});

// POI categories for the per-route access summary (Tier-1 minus transport + Tier-2)
const ROUTE_CATS = [
  ...Object.entries(TIER1).filter(([g]) => g !== "Public transport")
    .flatMap(([, cs]) => cs),
  ...TIER2,
];

// "Along the route" — for each category, how many of the route's stops have it
// within a 10-min walk (per-stop coverage; not a unique count).
function routeAccessHTML(cover, nStops, capped) {
  if (!nStops) return "";
  const rows = ROUTE_CATS.map((c) => ({ c, n: cover[c] || 0 }))
    .filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  if (!rows.length) return "";
  const bar = (n) => `<div style="flex:1;height:6px;border-radius:3px;background:var(--surface-2)">
    <div style="width:${Math.round(100 * n / nStops)}%;height:100%;border-radius:3px;
      background:var(--ui-primary)"></div></div>`;
  return `<div class="sec">
    <div class="sec-title">Along the route</div>
    <p class="hint">Of ${capped ? `${nStops} sampled stops` : `its ${nStops} stops`},
      how many have each of these within a <b>10-minute walk</b>:</p>
    ${rows.map((r) => `<div style="display:flex;align-items:center;gap:8px;
      margin:3px 0">
      <span style="flex:0 0 42%;font-size:13px">${CATEGORY_LABELS[r.c] || r.c}</span>
      ${bar(r.n)}
      <b style="flex:0 0 46px;text-align:right;font-size:13px">${r.n}/${nStops}</b>
    </div>`).join("")}
  </div>`;
}

function fcFromRingSets(ringSets, band) {
  return { type: "FeatureCollection", features: ringSets.map((rings) => ({
    type: "Feature", properties: { band },
    geometry: { type: "MultiPolygon", coordinates: rings.map((r) => [r]) } })) };
}

// layer visibility per view is set by the "walkatlas:showlayers" handler (map.js)
const AMENITY_LAYERS = ["amenity-extra"];
// the stop's walking range is context here, not the subject: keep it light
const WS_PIN_OPACITY_TRANSIT = 0.14;
const WS_PIN_OPACITY_BASE = 0.08;
// connected stops: medium discs with a white halo (default dots are 3.5 px)
// Bus & Metro: big clickable discs (the "genie" size), still faded for thin service
const STOP_R_DEFAULT = ["interpolate", ["linear"], ["zoom"], 12, 5, 14, ["match", ["get", "mode"], "metro", 9, "mmts", 9, 7], 16, 11];
const STOP_R_NETWORK = ["interpolate", ["linear"], ["zoom"], 12, 6, 14, 9, 16, 12];
const STOP_R_SMALL = ["interpolate", ["linear"], ["zoom"], 12, 2.5, 14, 4, 16, 5];

const setVis = (map, id, v) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v); };

export function enterTransit(map) {
  if (map.getLayer("stops")) map.setPaintProperty("stops", "circle-opacity", 1);   // one strength for every stop
  // streets and every place stay on the map; the stops grow (see showlayers in map.js)
  if (map.getLayer("wsp-fill"))
    map.setPaintProperty("wsp-fill", "fill-opacity", WS_PIN_OPACITY_TRANSIT);
  clearRoute(map);                  // clean slate: unfiltered stops, no lines
  greyStreetsTransit(map);          // no street colouring in this section
  renderTransitHome();
  showNotice();
  // open on a random well-served stop or metro station, close enough to tap
  const cands = POINTS.filter((f) => inCore(f.geometry.coordinates) && (f.properties.t === "metro" ||
    (f.properties.t === "bus" && f.properties.service_class === "frequent")));
  if (cands.length) {
    const f = cands[Math.floor(Math.random() * cands.length)];
    map.jumpTo({ center: f.geometry.coordinates, zoom: 15 });
  }
}

export function exitTransit(map) {
  if (map.getLayer("wsp-fill"))
    map.setPaintProperty("wsp-fill", "fill-opacity", WS_PIN_OPACITY_BASE);
  clearRoute(map);
}

export function clearRoute(map) {
  window._transitSel = false;
  if (!map.getSource("walkshed-pin")) return;   // style still loading: nothing to clear
  if (map.getLayer("stops")) {
    map.setFilter("stops", null);
    map.setLayerZoomRange("stops", 13, 24);        // restore the default LOD
    map.setPaintProperty("stops", "circle-radius", STOP_R_DEFAULT);
    map.setPaintProperty("stops", "circle-stroke-width", 1.2);
    map.setPaintProperty("stops", "circle-stroke-opacity", 1);
    clearReach(map);
  }
  map.setFilter("route-hl", ["==", "route_id", ""]);
  if (window._view === "transit") greyStreetsTransit(map);            // stay plain grey here
  else window.dispatchEvent(new CustomEvent("walkatlas:reapplyroads"));   // street colours back
  map.setPaintProperty("route-hl", "line-width", 2.5);
  map.setPaintProperty("route-hl", "line-opacity", 0.8);
  map.getSource("walkshed-pin").setData(
    { type: "FeatureCollection", features: [] });
  setPin(map, null);
  setFocus(map, null);
}

// plain grey streets for the whole section; retries until the style is ready
function greyStreetsTransit(map) {
  if (window._view !== "transit") return;
  try { map.setPaintProperty("streets", "line-color", "#C9CCD1"); } catch { setTimeout(() => greyStreetsTransit(map), 200); }
}

// highlight a set of stops: they grow and keep full colour, every other stop
// stays on the map but fades. Shown even when zoomed out (default is z13+).
function showStops(map, ids, thin) {
  if (!map.getLayer("stops")) return;
  // plain grey streets while routes are drawn, so the road colours don't compete
  try { map.setPaintProperty("streets", "line-color", "#C9CCD1"); } catch { /* not ready */ }
  const isIn = ["in", ["get", "stop_id"], ["literal", ids]];
  map.setFilter("stops", null);
  map.setLayerZoomRange("stops", 9, 24);
  // one zoom curve with the case inside each stop: MapLibre allows only a single
  // zoom interpolation per expression, so ["case", …, curveA, curveB] is rejected
  map.setPaintProperty("stops", "circle-radius", ["interpolate", ["linear"], ["zoom"],
    12, ["case", isIn, STOP_R_NETWORK[4], STOP_R_SMALL[4]],
    14, ["case", isIn, STOP_R_NETWORK[6], STOP_R_SMALL[6]],
    16, ["case", isIn, STOP_R_NETWORK[8], STOP_R_SMALL[8]]]);
  map.setPaintProperty("stops", "circle-opacity", ["case", isIn, 1, 0.25]);
  map.setPaintProperty("stops", "circle-stroke-opacity", ["case", isIn, 1, 0.4]);
  map.setPaintProperty("stops", "circle-stroke-width", ["case", isIn, 1.8, 1]);
  const w = thin ? ROUTE_LINE_THIN : ROUTE_LINE_SEL;
  map.setPaintProperty("route-hl", "line-width", w.w);
  map.setPaintProperty("route-hl", "line-opacity", w.o);
}

const dot = (c) => `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c};vertical-align:middle;margin-right:4px"></span>`;

export async function renderTransitHome() {
  const phone = matchMedia("(max-width: 768px)").matches;
  body().innerHTML = phone ? `
    <p class="verdict m-instr"><b>Select a stop or station</b> to see its routes and every stop you can reach without changing.</p>
    <p class="hint caveat" id="transit-summary"></p>${ROUTE_DISCLAIMER}` : `
  <div class="sec">
    <div class="sec-title">Transit</div>
    <p class="hint">Tap a stop to see where you can get to without changing buses,
      and how long it takes.</p>
    <p class="hint caveat" id="transit-summary"></p>
  </div>${ROUTE_DISCLAIMER}`;
  const c = await getTransitClasses();
  const el = document.getElementById("transit-summary");
  if (el && c?.counts_as_access) {
    const total = c.bus_total || Object.values(c.by_class || {}).reduce((a, b) => a + b, 0);
    el.textContent = `${c.counts_as_access.toLocaleString()} of ${total.toLocaleString()} bus stops `
      + `(${Math.round(100 * c.counts_as_access / total)}%) count as public-transport access. `
      + `The ${(total - c.counts_as_access).toLocaleString()} stops with one or two buses a day, or rush-hour service only, are left out of the City maps.`;
  }
}

export async function stopClickTransit(map, feature) {
  const { stop_id, stop_name, mode, service_class, peak_only,
          trips_per_day } = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  // bring the stop to the middle of the free map area (the card takes the right 380 px)
  const desktop = matchMedia("(min-width: 769px)").matches;
  map.easeTo({ center: [lng, lat], offset: desktop ? [-190, 0] : [0, 0], duration: 600 });
  const entry = await getStopEntry(stop_id, lng, lat);

  // the stop's walking range (5/10/15 bands), lightly, plus the pin marker
  const cellEntry = await getCellEntry(cellForLngLat(lng, lat));
  if (cellEntry?.ws) {
    const feats = [];
    for (const band of [15, 10, 5]) {
      if (cellEntry.ws[band]) {
        feats.push(...fcFromRingSets([cellEntry.ws[band]], band).features);
      }
    }
    map.getSource("walkshed-pin").setData(
      { type: "FeatureCollection", features: feats });
    // desktop: zoom and centre so the 15-minute range fills the map beside the card
    // (phones do the same from mobile.js, with the sheet's height as padding)
    if (desktop && feats.length) {
      let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
      const scan = (c) => Array.isArray(c[0]) ? c.forEach(scan)
        : (x0 = Math.min(x0, c[0]), y0 = Math.min(y0, c[1]), x1 = Math.max(x1, c[0]), y1 = Math.max(y1, c[1]));
      feats.forEach((f) => scan(f.geometry.coordinates));
      if (x0 <= x1) map.fitBounds([[x0, y0], [x1, y1]], { padding: { top: 80, bottom: 80, left: 80, right: 380 + 60 }, maxZoom: 15.5, duration: 700 });
    }
  }
  setPin(map, [lng, lat]);

  // connected network: every stop on every route serving this stop → discs,
  // and each of those routes drawn as a light line in its mode colour.
  const idx = await getRoutes();
  const servingNames = [...new Set((entry?.routes || []).map((r) => r.route))];
  const connected = new Set([stop_id]);
  for (const name of servingNames) {
    const info = idx[name];
    if (info) for (const s of info.stops) connected.add(s[0]);
  }
  showStops(map, [...connected], true);
  map.setFilter("route-hl", servingNames.length
    ? ["in", ["get", "route_short_name"], ["literal", servingNames]]
    : ["==", "route_id", ""]);
  // colour the reachable stops by travel time straight away — that is the view
  // people want; the legend below explains it
  lastStop = feature;
  window._transitSel = true;   // highlighted network stays visible when zoomed out
  let html = `
  <div class="card-head">
    <div class="card-head-txt">
      <span class="eyebrow">${MODE_LABEL[mode] || "Stop"}</span>
      <span class="card-title">${entry?.name || stop_name}</span>
    </div>
    <a href="#" id="transit-clear" class="pin-x" title="Clear" aria-label="Clear">✕</a>
  </div>
  <div class="sec">
    ${serviceBadge(mode, service_class, trips_per_day, peak_only)}
    ${mode === "mmts" ? MMTS_CAVEAT : ""}
  </div><div class="sec"><div class="sec-title">Routes here: tap one to
    highlight it</div>`;
  if (entry?.routes?.length) {
    const byDest = {};
    for (const r of entry.routes) (byDest[r.dest] ||= []).push(r);
    // most frequent destination first: "Every 20 min" → 20, "Every 15–30 min" → 15,
    // "2 trips/day" → very large
    const mins = (h) => { const m = /Every (\d+)/.exec(h || ""); if (m) return +m[1];
      const t = /(\d+) trips?\/day/.exec(h || ""); return t ? 5000 - +t[1] : 9999; };
    const groups = Object.entries(byDest).sort((a, b) => mins(a[1][0].headway) - mins(b[1][0].headway));
    for (const [dest, routes] of groups) {
      html += `<div class="dest-group" style="padding:6px 0 2px">
        <div class="dest">${dest}</div>
        <div class="chips">${routes.map((r) =>
          `<span class="chip ${r.mode}" data-route="${r.route}">${r.route}</span>`
        ).join("")}</div>
        <div class="svc">${routes[0].headway} · ${routes[0].span}
        ${routes[0].note ? `<span class="note"> · ${routes[0].note}</span>` : ""}</div>
      </div>`;
    }
  } else {
    html += `<p class="hint">No timetable data for this stop.</p>`;
  }
  html += `</div>${ROUTE_DISCLAIMER}`;
  body().innerHTML = html;

  document.getElementById("transit-clear").onclick = (e) => {
    e.preventDefault(); clearRoute(map); renderTransitHome();
  };
  body().querySelectorAll(".chip").forEach((chip) => {
    chip.style.cursor = "pointer";
    chip.onclick = () => selectRoute(map, chip.dataset.route);
  });
  window.dispatchEvent(new CustomEvent("walkatlas:opensheet"));   // expand the sheet on phones
}

export async function selectRoute(map, route) {
  const idx = await getRoutes();
  const info = idx[route];
  if (!info) return;

  // narrow the highlighted discs to this route + bolden its line; keep the
  // selected stop's walking range (set on stop click) as context.
  const sids = info.stops.map((s) => s[0]);
  showStops(map, sids, false);
  clearReach(map);
  map.setFilter("route-hl", ["==", ["get", "route_short_name"], route]);

  // per-stop access tally along the route
  const shown = info.stops.slice(0, MAX_ROUTE_SHEDS);
  const cover = {};            // category -> # of route stops with it ≤10 min
  let nWithData = 0;
  for (const [, lng, lat] of shown) {
    const entry = await getCellEntry(cellForLngLat(lng, lat));
    if (entry?.near) {
      nWithData++;
      for (const c of ROUTE_CATS) {
        const m = entry.near[c];
        if (m != null && m <= 10) cover[c] = (cover[c] || 0) + 1;
      }
    }
  }
  const capped = info.stops.length > MAX_ROUTE_SHEDS;

  body().innerHTML = `
  <div class="card-head">
    <a href="#" id="transit-back" class="pin-x back-x" title="Back to the stop" aria-label="Back to the stop">←</a>
    <div class="card-head-txt">
      <span class="eyebrow">${MODE_LABEL[info.mode] || info.mode} route</span>
      <span class="card-title">${route}</span>
      <span class="card-meta">${info.stops.length} stops in the mapped area</span>
    </div>
    <a href="#" id="transit-clear" class="pin-x" title="Clear" aria-label="Clear">✕</a>
  </div>
  <div class="sec">
    <p class="hint">The route's stops are highlighted on the map. Tap another stop
      to start from there.</p>
    ${info.mode === "mmts" ? MMTS_CAVEAT : ""}
  </div>
  ${routeAccessHTML(cover, nWithData, capped)}${ROUTE_DISCLAIMER}`;
  document.getElementById("transit-clear").onclick = (e) => {
    e.preventDefault(); clearRoute(map); renderTransitHome();
  };
  document.getElementById("transit-back").onclick = (e) => {
    e.preventDefault(); if (lastStop) stopClickTransit(map, lastStop); else { clearRoute(map); renderTransitHome(); }
  };
}
