// Hover walking range (desktop) / tap (mobile) + pinning + band toggle.
import { cellForLngLat, getCellEntry, getCellEntrySync,
         prefetchViewport } from "./shards.js";
import { renderCellPanel, renderHome } from "./panel.js";
import { writeHash } from "./hash.js";
import { setFocus, setPin, setNearLabels, CAT_ICON, IS_TOUCH, POINTS, DETAIL_ZOOM } from "./map.js";
import { CATEGORY_LABELS } from "../config.js";

// No 5 / 10 / 15 toggle: the map always draws all three rings, and the card
// reports nearest times (independent of the ring) and counts within 15 min.
const band = 15;
let hoverCell = null;
let pinnedEntry = null;

// nested isochrone up to the selected budget: one feature per band
// (10 under 5, etc.); translucent fills stack so the core reads darkest.
// Bands larger than the selected `band` are dropped, so 5/10/15 visibly resize.
function fc(ws) {
  if (!ws) return { type: "FeatureCollection", features: [] };
  const feats = [];
  for (const b of [15, 10, 5]) {
    if (b > band) continue;              // respect the chosen 5/10/15 budget
    const rings = ws[b];
    if (!rings) continue;
    feats.push({ type: "Feature", properties: { band: b },
      geometry: { type: "MultiPolygon", coordinates: rings.map((r) => [r]) } });
  }
  return { type: "FeatureCollection", features: feats };
}

// the rings of the selected budget (or the widest available below it)
const focusRings = (ws) => {
  if (!ws) return null;
  for (const b of [band, 10, 5]) if (b <= band && ws[b]) return ws[b];
  return null;
};

// ---- nearest-amenity callouts ---------------------------------------------
// The card says "bus stop · 5 min" but the cell data carries no id for that
// stop, so we find it on the map. Candidates: features of that category whose
// straight-line distance could fit the walk time (a walk of t minutes at
// 75 m/min can never end further than t × 75 m away). Those inside the band the
// time implies (5 min → the 5-min area) are preferred; nearest wins. Bus stops
// with almost no service are skipped (they are left out of the numbers too).
// point types per headline category (points.geojson `t`)
const T_OF = { bus_stop: "bus", metro: "metro", mmts: "mmts", school: "school",
               park: "park", playground: "park", public_toilet: "toilet" };
const GROUPS = [["bus_stop", "metro", "mmts"], ["school"], ["park", "playground"], ["public_toilet"]];
const poly = (rings) => ({ type: "MultiPolygon", coordinates: rings.map((r) => [r]) });
const M_PER_MIN = 90, SLACK_M = 90;   // 5.4 km/h, the downhill peak of the Tobler curve; slack ≈ one grid cell
function metres(a, b) {
  const dx = (a[0] - b[0]) * 111320 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180);
  const dy = (a[1] - b[1]) * 110574;
  return Math.sqrt(dx * dx + dy * dy);
}
function inRing(pt, ring) {   // ray casting, ring = [[lng, lat], …]
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inRings = (pt, rings) => !!rings && rings.some((r) => inRing(pt, r));
// The card says "bus stop · 5 min" but the cell data carries no id for that
// stop, so we find it in the full point list (points.geojson, nothing dropped):
// same type, straight-line distance within t × 75 m + slack, preferring points
// inside the ring the time implies; nearest wins. Minimal / rush-hour-only bus
// stops are skipped, as in the numbers.
let lastLabels = "";   // setData only on change
function labelNearest(map, entry, lngLat) {
  const near = entry?.near || {}, ws = entry?.ws;
  if (!ws || !POINTS.length) { setNearLabels(map, []); lastLabels = ""; return; }
  const feats = [];
  for (const cats of GROUPS) {
    let best = null;
    for (const c of cats) {
      const t = near[c];
      if (t != null && t <= band && (!best || t < best.t)) best = { c, t };
    }
    if (!best) continue;
    const t = T_OF[best.c], limit = best.t * M_PER_MIN + SLACK_M;
    const cands = [];
    for (const f of POINTS) {
      const p = f.properties;
      if (p.t !== t) continue;
      if (best.c === "park" && p.category === "playground") continue;
      if (best.c === "playground" && p.category !== "playground") continue;
      if (t === "bus" && (p.service_class === "ghost" || p.peak_only)) continue;
      const d = metres(f.geometry.coordinates, lngLat);
      if (d <= limit) cands.push({ f, d });
    }
    if (!cands.length) continue;
    const ring = ws[best.t <= 5 ? 5 : best.t <= 10 ? 10 : 15];
    const inside = cands.filter((x) => inRings(x.f.geometry.coordinates, ring));
    const pick = (inside.length ? inside : cands).reduce((a, b) => (b.d < a.d ? b : a));
    const mins = best.t < 1 ? "under 1 min" : `${Math.round(best.t)} min`;
    feats.push({ type: "Feature",
      properties: { icon: CAT_ICON[best.c] || "ic-other", label: `${CATEGORY_LABELS[best.c]} · ${mins}` },
      geometry: { type: "Point", coordinates: pick.f.geometry.coordinates } });
  }
  const key = JSON.stringify(feats);
  if (key !== lastLabels) { lastLabels = key; setNearLabels(map, feats); }
}

// the walking range only draws at street scale; further out a hint asks to zoom in
export const HOVER_MIN_ZOOM = DETAIL_ZOOM;
function zoomHint(map) {
  const el = document.getElementById("zoom-hint");
  if (!el) return;
  const v = window._view, z = map.getZoom();
  const show = (v === "explore" && z < HOVER_MIN_ZOOM) || (v === "transit" && z < 13 && !window._transitSel);
  el.hidden = !show;
  el.querySelector("span").textContent = v === "transit" ? "Zoom in to see the stops" : "Zoom in to see how far you can walk";
}

// preview the walking range from the centre of the screen until the pointer
// takes over (page open, after a jump/search). Touch devices: on every settle.
function previewCentre(map) {
  if (window._view !== "explore" || window._pinnedCell || map.getZoom() < HOVER_MIN_ZOOM) return;
  if (!map.getSource("walkshed")) { map.once("load", () => previewCentre(map)); return; }   // a link opened before the style
  const c = map.getCenter();
  const cell = cellForLngLat(c.lng, c.lat);
  hoverCell = cell;
  const entry = getCellEntrySync(cell);
  if (entry === undefined) { getCellEntry(cell).then(() => { if (hoverCell === cell) previewCentre(map); }); return; }
  setFocus(map, entry ? focusRings(entry.ws) : null);
  setPin(map, [c.lng, c.lat]);           // a dot marks the spot being previewed
  map.getSource("walkshed").setData(entry ? fc(entry.ws) : fc(null));
}

export function initWalkshed(map) {
  prefetchViewport(map);
  map.once("idle", () => previewCentre(map));
  let pointerSeen = false;
  map.on("moveend", () => { if (!pointerSeen || IS_TOUCH) previewCentre(map); });
  // a section switch puts the map on a new random spot: preview it even if the
  // pointer has already taken over once
  window.addEventListener("walkatlas:previewcentre", () => map.once("idle", () => previewCentre(map)));
  map.getCanvas().addEventListener("mousemove", () => {
    pointerSeen = true;
    if (!window._pinnedCell) setPin(map, null);   // the pointer takes over from the centre dot
  }, { once: true });
  map.getCanvas().classList.add("walk-cursor");
  map.on("moveend", () => prefetchViewport(map));
  map.on("zoom", () => zoomHint(map));
  window.addEventListener("walkatlas:viewchange", () => zoomHint(map));
  zoomHint(map);
  // points arrive after the first pin on a fresh load: label again
  window.addEventListener("walkatlas:points", () => {
    if (window._pinnedCell && pinnedEntry) labelNearest(map, pinnedEntry, window._pinnedCoords);
  });

  if (!IS_TOUCH) {
    map.on("mousemove", (e) => {
      if (window._view !== "explore") return;
      if (window._pinnedCell) {                    // a pinned range stands alone: no hover range over it (Teja, 7 Nov 2026)
        if (hoverCell) { hoverCell = null; map.getSource("walkshed").setData(fc(null)); }
        return;
      }
      if (map.getZoom() < HOVER_MIN_ZOOM) {       // too far out: no range, just the hint
        if (hoverCell) { hoverCell = null; map.getSource("walkshed").setData(fc(null));
                         if (!window._pinnedCell) setFocus(map, null); }
        return;
      }
      const cell = cellForLngLat(e.lngLat.lng, e.lngLat.lat);
      if (cell === hoverCell) return;
      hoverCell = cell;
      const entry = getCellEntrySync(cell);
      map.getSource("walkshed").setData(entry ? fc(entry.ws) : fc(null));
      if (!window._pinnedCell) setFocus(map, entry ? focusRings(entry.ws) : null);
    });
    map.getCanvas().addEventListener("mouseleave", () => {
      hoverCell = null;
      map.getSource("walkshed").setData(fc(null));
      if (!window._pinnedCell) setFocus(map, null);
    });
  }

  // pin the walking range at a location; `place` (optional) adds a name/category
  // header — used when the pin comes from an amenity / transit icon click
  async function pinCell(lng, lat, place) {
    if (!map.getSource("walkshed-pin")) return;   // style still loading
    const cell = cellForLngLat(lng, lat);
    const entry = await getCellEntry(cell);
    if (!entry) { unpin(map); return; }
    window._pinnedCell = cell;
    window._pinnedPlace = place || null;
    window._pinnedCoords = [lng, lat];
    // bring the spot to the middle of the free map area (the card takes the right 380 px)
    const desktop = matchMedia("(min-width: 769px)").matches;
    map.easeTo({ center: [lng, lat], offset: desktop ? [-190, 0] : [0, 0], duration: 600 });
    map.getSource("walkshed-pin").setData(fc(entry.ws));
    map.getSource("walkshed").setData(fc(null));
    hoverCell = null;                             // after unpin, the next move draws the hover range again
    setFocus(map, focusRings(entry.ws));
    setPin(map, [lng, lat]);
    scopeLayersToWalkshed(map, entry.ws);
    labelNearest(map, entry, [lng, lat]);
    pinnedEntry = entry;
    const ward = wardAt(map, [lng, lat]);
    renderCellPanel(entry, band, place, [lng, lat], ward);
    // boundary tiles not drawn yet (fresh area): fill the ward in once the map settles
    if (!ward) map.once("idle", () => {
      const w = window._pinnedCell === cell && wardAt(map, [lng, lat]);
      if (w) renderCellPanel(entry, band, place, [lng, lat], w);
    });
    writeHash(map, window._activeLayer, cell);
    window.dispatchEvent(new CustomEvent("walkatlas:opensheet"));   // expand the sheet on phones
  }


  const HIT_LAYERS = ["amenity-icons", "amenity-extra", "stop-icons", "amenity-hit", "stop-hit"];
  map.on("click", (e) => {
    if (window._view !== "explore") return;
    // let stop/amenity clicks win (handled via walkatlas:pinat)
    const hits = map.queryRenderedFeatures(e.point,
      { layers: HIT_LAYERS.filter((l) => map.getLayer(l)) });
    if (hits.length) return;
    if (map.getZoom() < HOVER_MIN_ZOOM) {       // too far out: zoom in on the spot, then pin
      map.once("moveend", () => pinCell(e.lngLat.lng, e.lngLat.lat));
      map.easeTo({ center: e.lngLat, zoom: 14.5, duration: 700 });
      return;
    }
    pinCell(e.lngLat.lng, e.lngLat.lat);
  });

  // amenity / transit icon click → pin the walkshed there with a name header
  window.addEventListener("walkatlas:pinat", (e) =>
    pinCell(e.detail.lng, e.detail.lat, e.detail.place));
  window.addEventListener("walkatlas:unpin", () => unpin(map));
  // checkbox in the panel picks the overlay category (null = clear)
  window.addEventListener("walkatlas:extraamenity", (e) => {
    window._amenityExtra = e.detail || null;
    applyExtraAmenity(map);
  });
}

// the ward under a point, read off the boundary tiles already on the map (no
// lookup service): a hit-test on the invisible ward fill. null when the point
// is off-screen or the tiles for that spot are not loaded yet.
export function wardAt(map, lngLat) {
  try {
    if (!map.getLayer("ward-pick")) return null;
    const hits = map.queryRenderedFeatures(map.project(lngLat), { layers: ["ward-pick"] });
    return hits.length ? hits[0].properties : null;
  } catch { return null; }
}

// Points are never hidden by the pin: outside the walking range they fade under
// the focus mask (map.js puts the icon layers below it). Only the "Show on map"
// category toggles filter the amenity icons. The tier-2 overlay stays confined
// to the pinned range (pinWithin).
const CAT_LAYERS = ["amenity-icons", "amenity-hit"];
const ALL_CATS = ["school", "park", "playground", "public_toilet"];
function catFilter() {
  const cats = window._showCats || ALL_CATS;
  return ["in", ["get", "category"], ["literal", cats.length ? cats : ["__none__"]]];
}
let pinWithin = null;   // the pinned-range polygon test (null = unpinned)

function scopeLayersToWalkshed(map, ws) {
  const rings = focusRings(ws);
  pinWithin = rings ? ["within", poly(rings)] : null;
  applyExtraAmenity(map);
}
function unscopeLayers(map) {
  pinWithin = null;
  applyExtraAmenity(map);
}

// "Show on map" toggles changed → rebuild the category filter
window.addEventListener("walkatlas:showlayers", () => {
  const map = window._map;
  if (!map) return;
  for (const lyr of CAT_LAYERS) if (map.getLayer(lyr)) map.setFilter(lyr, catFilter());
});

// the single "More amenities" overlay: the chosen category, confined to the
// pinned walkshed. Hidden when nothing is checked or nothing is pinned.
function applyExtraAmenity(map) {
  if (!map.getLayer("amenity-extra")) return;
  const cat = window._amenityExtra;
  map.setFilter("amenity-extra", (cat && pinWithin)
    ? ["all", ["==", ["get", "category"], cat], pinWithin]
    : ["==", ["get", "category"], "__none__"]);
}

function unpin(map) {
  const had = window._pinnedCell;
  window._pinnedCell = null;
  if (had && location.hash.length > 1) history.replaceState(null, "", location.pathname + location.search);   // plain URL again
  lastLabels = "";
  window._pinnedPlace = null;
  if (!map.getSource("walkshed-pin")) { renderHome(window._view); return; }   // style still loading
  map.getSource("walkshed-pin").setData(fc(null));
  setFocus(map, null);
  setPin(map, null);
  setNearLabels(map, []);
  unscopeLayers(map);
  renderHome(window._view);
}
