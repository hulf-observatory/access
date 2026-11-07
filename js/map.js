// Map init: basemap, PMTiles protocol, all layers, layer switcher UI.
// All sources + layers are declared in the initial style JSON — nothing is
// added after construction, so there is no wait-for-style race and a slow
// basemap can never block the app.
import { DATA_URL, START, MAX_BOUNDS, BASEMAP, BASEMAP_STYLE, ACCESS_LAYERS,
         MODE_COLORS, WALK_COLOR } from "../config.js";
import * as pmtiles from "../vendor/pmtiles.js";

export let endpoints = null;
export function setEndpoints(ep) { endpoints = ep; }   // report.html builds the same style

const EMPTY_FC = { type: "FeatureCollection", features: [] };
const CANVAS = "#EDEEF0";   // page ground; also the "faded" mask colour
export const IS_TOUCH = matchMedia("(pointer: coarse)").matches;

// selected drill-down unit outline: one line pair per admin level, filters
// start matching nothing and are driven by highlightSelected().
const SEL_LAYERS = ["corporations", "zones", "circles", "wards", "special"];
const SEL_NONE = ["==", ["get", "__sel__"], "__none__"];   // matches nothing

// street line-colour options (the "Colour streets by" dropdown). Continuous
// vars use a gradient legend (grad/lo/hi); categorical vars list swatches.
// Ramps: the BAD end is the loud one (exposed / steep = dark warm), the good
// end is cool and quiet, so a zoomed-out city does not read as leafy.
const ROAD_STYLES = {
  shade: { label: "Shade",
    color: ["interpolate", ["linear"], ["coalesce", ["get", "shade_annual"], 0.4],
      0.1, "#A93A1E", 0.4, "#E8CFA3", 0.75, "#7FA6BF"],
    grad: "linear-gradient(90deg,#A93A1E,#E8CFA3,#7FA6BF)",
    lo: "Exposed", hi: "Shaded" },
  tree: { label: "Tree cover",
    color: ["interpolate", ["linear"], ["coalesce", ["get", "tree_cover"], 0],
      0, "#D9D4C7", 0.5, "#7FB069", 1, "#1B7A32"],
    grad: "linear-gradient(90deg,#D9D4C7,#7FB069,#1B7A32)",
    lo: "No trees", hi: "Tree-lined" },
  slope: { label: "Slope",
    color: ["interpolate", ["linear"], ["coalesce", ["get", "slope_pct"], 0],
      0, "#B9C4C9", 4, "#E3B368", 8, "#C2492A", 12, "#7A1B14"],
    grad: "linear-gradient(90deg,#B9C4C9,#E3B368,#C2492A,#7A1B14)",
    lo: "Flat", hi: "Steep" },
  tier: { label: "Road type",   // discrete: highway (OSM motorway/trunk) as its
    // own class; the rest split main/side/lane by stroke-length percentile
    // (pipeline tiers major/connector/local). Lanes stay quiet so the big roads read first.
    color: ["case",
      ["in", "Outer Ring Road", ["coalesce", ["get", "name"], ""]], "#3E8E8E",
      ["match", ["get", "tier"],
        "highway", "#C0634B", "major", "#4B5563", "connector", "#9CA3AF", "#D5D8DD"]],
    cats: [["#C0634B", "Highway"], ["#4B5563", "Main road"], ["#9CA3AF", "Side road"],
           ["#D5D8DD", "Lane"], ["#3E8E8E", "Outer Ring Road"]] },
  // Footpath colouring comes from OpenStreetMap, which knows footpaths for only
  // a few % of streets. Kept out of the menu until the ground survey replaces it
  // (see About → footpaths). Add "footpath" back to ROAD_ORDER to re-enable.
  footpath: { label: "Footpath",
    color: ["match", ["get", "footpath_status"], "yes", "#2E7D32", "no", "#C62828", "#B8B3A6"],
    cats: [["#2E7D32", "Footpath"], ["#C62828", "None"], ["#B8B3A6", "Unknown"]] },
};
const ROAD_ORDER = ["tier", "shade", "tree", "slope"];
export const ROAD_DEFAULT = "tier";

// street opacity: quiet when nothing is hovered / pinned, full inside a focus
const STREETS_IDLE = 0.4, STREETS_FOCUS = 0.9;

// discrete line width per hierarchy tier (highway → main → connector → local),
// scaled by zoom for LOD. lc is also the default (local + anything untagged).
const TIER_W = (hw, mj, cn, lc) => ["match", ["get", "tier"],
  "highway", hw, "major", mj, "connector", cn, lc];

const MODE_COLOR_EXPR = ["match", ["get", "mode"],
  "metro", MODE_COLORS.metro, "mmts", MODE_COLORS.mmts, MODE_COLORS.bus];

// base = a fetched MapLibre style (vector basemap) or null → CARTO raster fallback.
// With a vector base, our layers are spliced in UNDER its label (symbol) layers so
// place names stay readable over the access rasters and street colouring. A few
// layers (pin marker, nearest-amenity labels) go ABOVE the labels.
export function buildStyle(base) {
  const T = (k) => `pmtiles://${DATA_URL}/${endpoints.tiles[k]}`;
  const sources = {
    walkshed: { type: "geojson", data: EMPTY_FC },
    "walkshed-pin": { type: "geojson", data: EMPTY_FC },
    "focus-mask": { type: "geojson", data: EMPTY_FC },
    "pin-pt": { type: "geojson", data: EMPTY_FC },
    "near-labels": { type: "geojson", data: EMPTY_FC },
    // every headline point (stops + schools / parks / toilets) from points.geojson,
    // drawn from street scale (DETAIL_ZOOM) like the walking range; filled after load
    points: { type: "geojson", data: EMPTY_FC },
  };
  if (base) Object.assign(sources, base.sources);
  else sources.base = { type: "raster", tiles: [BASEMAP], tileSize: 512,
                        attribution: "© CARTO © OpenStreetMap" };
  for (const k of Object.keys(endpoints.tiles)) {
    const raster = k.startsWith("near_") || k === "shade" || k === "canopy";
    sources[k] = { type: "vector", url: T(k) };
    if (raster) sources[k] = { type: "raster", url: T(k), tileSize: 256 };
  }

  const layers = [];   // our layers under the labels; merged with the base at the end
  const top = [];      // above the labels

  for (const k of Object.keys(ACCESS_LAYERS)) {   // access rasters (radio-toggled)
    if (k === "none") continue;
    layers.push({ id: `r-${k}`, type: "raster", source: k,
      layout: { visibility: "none" },
      paint: { "raster-opacity": 0.62,
               "raster-resampling": "linear" } });
  }

  // streets: colored by the selected road variable (default shade), width by tier
  layers.push({
    id: "streets", type: "line", source: "streets", "source-layer": "streets",
    paint: {
      "line-color": ROAD_STYLES.tier.color,
      // width = discrete by hierarchy tier, scaled by zoom. Highway + main are
      // always visible (skeleton when zoomed out); connector fades in ~z11,
      // local ~z13. Park internal paths (in_park=1) draw as thin fixed trails.
      "line-width": ["interpolate", ["linear"], ["zoom"],
        9,  ["case", ["==", ["get", "in_park"], 1], 0,   TIER_W(1.4, 0,   0,   0)],
        11, ["case", ["==", ["get", "in_park"], 1], 0,   TIER_W(2.0, 0,   0,   0)],
        12, ["case", ["==", ["get", "in_park"], 1], 0,   TIER_W(2.5, 1.4, 0,   0)],
        13, ["case", ["==", ["get", "in_park"], 1], 0.3, TIER_W(2.8, 1.8, 0.9, 0.5)],
        16, ["case", ["==", ["get", "in_park"], 1], 0.8, TIER_W(5,   3.6, 2.0, 1.1)]],
      "line-opacity": STREETS_IDLE,
      "line-opacity-transition": { duration: 150 },
    },
  });

  // only the main amenities appear on the map (as icons, added on load):
  // transport (stops) · schools · parks/playgrounds · toilets. Everything else
  // is counts-only in the panel — no map markers.
  layers.push({
    id: "stops", type: "circle", source: "transit", "source-layer": "stops",
    minzoom: 13,
    paint: {
      // bus radius/opacity taper with service class: minimal (ghost) & low-
      // frequency stops read fainter than genuine service (see SERVICE_CLASS).
      "circle-radius": ["match", ["get", "mode"], "metro", 5.5, "mmts", 5.5,
        ["match", ["get", "service_class"], "ghost", 2.2, "low", 3, 3.5]],
      "circle-color": MODE_COLOR_EXPR,
      "circle-opacity": ["match", ["get", "service_class"],
        "ghost", 0.4, "low", 0.72, 1],
      "circle-stroke-width": 1.2, "circle-stroke-color": "#FFFFFF",
    },
  });

  // focus mask: everything OUTSIDE the hovered / pinned walking range fades to
  // the page colour, so the range and the streets inside it become the subject
  layers.push({ id: "focus-mask", type: "fill", source: "focus-mask",
    paint: { "fill-color": CANVAS, "fill-opacity": 0.55 } });

  // route highlight (hidden until a chip is tapped), in the route's mode colour
  layers.push({
    id: "route-hl", type: "line", source: "transit", "source-layer": "routes",
    filter: ["==", "route_id", ""],
    paint: { "line-color": MODE_COLOR_EXPR, "line-width": 2.5, "line-opacity": 0.8 },
  });

  // walking range (hover + pinned): all three rings at once. Fills stack, so the
  // 5-min core reads darkest; each ring also has its own line so the edges can
  // be told apart without colour: 15 = dashed, 10 = fine dashes, 5 = thin solid.
  const RING = { 15: { w: 1.6, o: 1, dash: [3, 2] }, 10: { w: 1.1, o: 0.7, dash: [1.5, 1.5] },
                 5: { w: 1.1, o: 0.85, dash: null } };
  for (const [src, pre] of [["walkshed", "ws"], ["walkshed-pin", "wsp"]]) {
    layers.push({ id: `${pre}-fill`, type: "fill", source: src,
      paint: { "fill-color": WALK_COLOR, "fill-opacity": pre === "wsp" ? 0.07 : 0.05 } });
    for (const b of [15, 10, 5]) {
      const r = RING[b];
      layers.push({ id: `${pre}-line-${b}`, type: "line", source: src,
        filter: ["==", ["get", "band"], b],
        paint: { "line-color": pre === "wsp" ? WALK_COLOR : "#4B5563",
                 "line-width": pre === "wsp" ? r.w : r.w * 0.85, "line-opacity": r.o,
                 ...(r.dash ? { "line-dasharray": r.dash } : {}) } });
    }
  }

  // ward boundaries: off in Explore by default (a "Show on map" toggle), on in Wards
  layers.push({
    id: "wards", type: "line", source: "boundaries", "source-layer": "wards",
    layout: { visibility: "none" },
    paint: { "line-color": "#111", "line-width": 0.7,
             "line-dasharray": [4, 3], "line-opacity": 0.35 },
  });
  // invisible ward fill: lets a click / pin look up its ward from the tiles
  layers.push({
    id: "ward-pick", type: "fill", source: "boundaries", "source-layer": "wards",
    paint: { "fill-color": "#000", "fill-opacity": 0 },
  });
  // ward under the cursor (Wards view choropleth)
  layers.push({
    id: "ward-hover", type: "line", source: "boundaries", "source-layer": "wards",
    filter: SEL_NONE,
    paint: { "line-color": WALK_COLOR, "line-width": 1.6 },
  });

  for (const sl of SEL_LAYERS) {   // selected-unit: fade everything else, outline it
    layers.push({
      id: `sel-${sl}-casing`, type: "line", source: "boundaries", "source-layer": sl,
      filter: SEL_NONE,
      paint: { "line-color": "#FFFFFF", "line-width": 4.5, "line-opacity": 0.95 },
    });
    layers.push({
      id: `sel-${sl}`, type: "line", source: "boundaries", "source-layer": sl,
      filter: SEL_NONE,
      paint: { "line-color": WALK_COLOR, "line-width": 2.2 },
    });
  }

  // ---- above the labels: pin marker + nearest-amenity callouts ----
  top.push({ id: "pin-ring", type: "circle", source: "pin-pt",
    paint: { "circle-radius": 9, "circle-color": "#FFFFFF",
             "circle-stroke-width": 1, "circle-stroke-color": "rgba(0,0,0,.15)" } });
  top.push({ id: "pin-dot", type: "circle", source: "pin-pt",
    paint: { "circle-radius": 4.5, "circle-color": WALK_COLOR } });
  top.push({
    id: "ws-ring-labels", type: "symbol", source: "walkshed", minzoom: 12,
    layout: {
      visibility: "none",   // shown only during the first-load intro
      "symbol-placement": "line", "symbol-spacing": 420,
      "text-field": ["concat", ["to-string", ["get", "band"]], " min"],
      "text-font": base ? ["Noto Sans Bold"] : ["Open Sans Semibold"],
      "text-size": 11, "text-keep-upright": true, "text-max-angle": 30,
    },
    paint: { "text-color": WALK_COLOR, "text-halo-color": "#FFFFFF", "text-halo-width": 1.6 },
  });
  top.push({
    id: "wsp-ring-labels", type: "symbol", source: "walkshed-pin", minzoom: 12,
    layout: {
      "symbol-placement": "line", "symbol-spacing": 420,
      "text-field": ["concat", ["to-string", ["get", "band"]], " min"],
      "text-font": base ? ["Noto Sans Bold"] : ["Open Sans Semibold"],
      "text-size": 11, "text-keep-upright": true, "text-max-angle": 30,
    },
    paint: { "text-color": WALK_COLOR, "text-halo-color": "#FFFFFF", "text-halo-width": 1.6 },
  });
  top.push({
    id: "near-labels", type: "symbol", source: "near-labels",
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 0.62, 16, 0.8],
      "icon-allow-overlap": true, "icon-ignore-placement": true,
      "text-field": ["get", "label"],
      "text-font": base ? ["Noto Sans Bold"] : ["Open Sans Semibold"],
      // labels try below, above, right, left of the icon so neighbours don't collide
      "text-size": 12, "text-radial-offset": 1.2,
      "text-variable-anchor": ["top", "bottom", "left", "right"], "text-justify": "auto",
      "text-allow-overlap": false, "text-padding": 2,
    },
    paint: { "text-color": WALK_COLOR, "text-halo-color": "#FFFFFF", "text-halo-width": 1.6 },
  });

  if (base) {
    const cut = base.layers.findIndex((l) => l.type === "symbol");
    const under = cut < 0 ? base.layers : base.layers.slice(0, cut);
    // labels: keep place / water names, drop road names + shields — our coloured
    // streets are the subject of the map and road names clutter them
    const labels = (cut < 0 ? [] : base.layers.slice(cut))
      .filter((l) => !/^(highway-name|highway-shield|road_shield)/.test(l.id));
    return { version: 8, glyphs: base.glyphs, sprite: base.sprite,
             sources, layers: [...under, ...layers, ...labels, ...top] };
  }
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources, layers: [{ id: "base", type: "raster", source: "base" }, ...layers, ...top],
  };
}

// fetch the vector basemap style; null on any failure (→ raster fallback)
export async function fetchBaseStyle() {
  if (!BASEMAP_STYLE) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(BASEMAP_STYLE, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// ---- focus helpers (used by walkshed.js / transit.js) -----------------------
// mask = the world minus the given rings (one MultiPolygon band, e.g. ws[15])
const WORLD = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
export function setFocus(map, rings) {
  const src = map.getSource("focus-mask");
  if (!src) return;
  src.setData(rings && rings.length
    ? { type: "Feature", properties: {},
        geometry: { type: "Polygon", coordinates: [WORLD, ...rings] } }
    : EMPTY_FC);
  if (map.getLayer("streets"))
    map.setPaintProperty("streets", "line-opacity", rings && rings.length ? STREETS_FOCUS : STREETS_IDLE);
}
export function setPin(map, lngLat) {
  const src = map.getSource("pin-pt");
  if (!src) return;
  src.setData(lngLat ? { type: "Feature", properties: {},
    geometry: { type: "Point", coordinates: lngLat } } : EMPTY_FC);
}
export function setNearLabels(map, feats) {
  const src = map.getSource("near-labels");
  if (src) src.setData({ type: "FeatureCollection", features: feats || [] });
}

// outline the area picked in the breadcrumb (no fading). cs = {level, key, unit} | null
export function highlightSelected(cs) {
  const map = window._map;
  if (!map || !map.getLayer(`sel-${SEL_LAYERS[0]}`)) return;
  for (const sl of SEL_LAYERS) {          // clear all first
    map.setFilter(`sel-${sl}`, SEL_NONE);
    map.setFilter(`sel-${sl}-casing`, SEL_NONE);
  }
  if (!cs || cs.level === "extent") return;
  const u = cs.unit || {};
  let sl, field, val;
  if (u.special) { sl = "special"; field = ["get", "name"]; val = cs.key; }
  else if (cs.level === "corporations") { sl = "corporations"; field = ["get", "corporation"]; val = cs.key; }
  else if (cs.level === "zones") { sl = "zones"; field = ["get", "zone"]; val = cs.key; }
  // ward numbers are Numbers in the tiles but "1.0"-style keys in summaries.json
  else if (cs.level === "wards") { sl = "wards"; field = ["to-number", ["get", "ward_no"]]; val = Number(cs.key); }
  else return;
  map.setFilter(`sel-${sl}`, ["==", field, val]);
  map.setFilter(`sel-${sl}-casing`, ["==", field, val]);
}

export async function initMap(hash) {
  const [ep, base] = await Promise.all([
    fetch(`${DATA_URL}/endpoints.json`, { cache: "no-cache" }).then((r) => r.json()),
    fetchBaseStyle(),
  ]);
  endpoints = ep;
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  const map = new maplibregl.Map({
    container: "map",
    center: hash.center || START.center,
    zoom: hash.zoom || START.zoom,
    minZoom: 9, maxZoom: 17.5,
    maxBounds: MAX_BOUNDS,
    style: buildStyle(base),
    attributionControl: { compact: true },   // the ⓘ starts folded
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.GeolocateControl({}), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
  // MapLibre opens the compact attribution on first load; start it folded
  map.once("load", () => {
    const a = document.querySelector(".maplibregl-ctrl-attrib");
    if (a) { a.classList.remove("maplibregl-compact-show"); a.removeAttribute("open"); }
  });

  buildSwitcher(map, hash.layer);
  buildRoadViz(map);
  buildShowLayers(map);
  // add the icon layers once the style is ready, then load their images
  // (layers first so they pick up images the moment they decode)
  (function setupIcons() {
    if (map.style && map.style._loaded) { addIconLayers(map); loadIcons(map); }
    else setTimeout(setupIcons, 150);
  })();
  return map;
}

// ---- amenity / transit icon markers ----------------------------------------
// coloured disc + white pictogram drawn straight onto a canvas (no sprite/CDN,
// no SVG decode) → ImageData added to the map synchronously.
// transit = mode-coloured discs with a white glyph; amenities keep their
// category colour.
// transit discs use the fixed mode colours (same as Bus & Metro, legend, chips)
const ICON_DEFS = {
  "ic-bus":    { color: MODE_COLORS.bus, glyph: "bus" },
  "ic-metro":  { color: MODE_COLORS.metro, glyph: "metro" },   // white "M"
  "ic-mmts":   { color: MODE_COLORS.mmts, glyph: "train" },
  "ic-school": { color: "#B0870F", glyph: "cap" },
  "ic-park":   { color: "#2E7D32", glyph: "tree" },
  "ic-toilet": { color: "#3C7D8E", glyph: "wc" },
  "ic-other":  { color: "#5B4B8A", glyph: "dot" },   // generic single-select overlay pin
};
const _rr = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
};
const _dot = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };

function drawGlyph(ctx, glyph, color) {
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#fff";
  if (glyph === "bus") {
    _rr(ctx, 13, 13, 18, 15, 3); ctx.fill();
    ctx.fillStyle = color; _rr(ctx, 15.5, 15.5, 13, 4, 1); ctx.fill();
    ctx.fillStyle = "#fff"; _dot(ctx, 17, 30.5, 2); _dot(ctx, 27, 30.5, 2);
  } else if (glyph === "train") {
    ctx.beginPath(); ctx.moveTo(13, 29); ctx.lineTo(13, 21);
    ctx.arc(22, 21, 9, Math.PI, 0, false); ctx.lineTo(31, 29); ctx.closePath(); ctx.fill();
    ctx.fillStyle = color; _rr(ctx, 15, 18, 14, 4, 1); ctx.fill();
    ctx.fillStyle = "#fff"; _dot(ctx, 18, 32, 1.9); _dot(ctx, 26, 32, 1.9);
  } else if (glyph === "metro") {
    ctx.font = "700 20px Outfit, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("M", 22, 23.5);
  } else if (glyph === "cap") {
    ctx.beginPath(); ctx.moveTo(22, 12); ctx.lineTo(35, 18);
    ctx.lineTo(22, 24); ctx.lineTo(9, 18); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(15, 21); ctx.lineTo(15, 27);
    ctx.quadraticCurveTo(22, 32, 29, 27); ctx.lineTo(29, 21); ctx.stroke();
  } else if (glyph === "tree") {
    _dot(ctx, 22, 19, 7.5); ctx.fillRect(20.7, 24, 2.6, 8.5);
  } else if (glyph === "wc") {
    ctx.font = "700 15px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("WC", 22, 23.5);
  } else if (glyph === "dot") {
    _dot(ctx, 22, 22, 6);
  }
}

// drawGlyph uses 44px-based coordinates; render on a 2× canvas and downscale
// on the GPU (higher pixelRatio) so the discs/glyphs stay crisp when zoomed.
const ICON_PX = 44, ICON_SS = 2;
function makeIconCanvas(def) {
  const s = ICON_PX * ICON_SS;
  const cv = document.createElement("canvas"); cv.width = cv.height = s;
  const ctx = cv.getContext("2d");
  ctx.scale(ICON_SS, ICON_SS);   // keep drawGlyph coordinates in 44px space
  ctx.beginPath(); ctx.arc(ICON_PX / 2, ICON_PX / 2, ICON_PX / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = def.color; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = "#FFFFFF"; ctx.stroke();
  drawGlyph(ctx, def.glyph, def.color);
  return cv;
}

// add all amenity/transit icon images to a map (reused by the report page)
export function loadIcons(map) {
  const s = ICON_PX * ICON_SS;
  for (const [name, def] of Object.entries(ICON_DEFS)) {
    if (map.hasImage(name)) continue;
    const ctx = makeIconCanvas(def).getContext("2d");
    try { map.addImage(name, ctx.getImageData(0, 0, s, s), { pixelRatio: ICON_SS * 2 }); }
    catch (e) { /* ignore */ }
  }
}

// small legend icon (data URL) for the detail panel — same disc+glyph as the map
export const CAT_ICON = {
  bus_stop: "ic-bus", metro: "ic-metro", mmts: "ic-mmts", school: "ic-school",
  park: "ic-park", playground: "ic-park", public_toilet: "ic-toilet",
};
const _iconURL = {};
export function iconDataURL(category) {
  const name = CAT_ICON[category] || "ic-other";   // tier-2 → neutral overlay pin
  return _iconURL[name] || (_iconURL[name] = makeIconCanvas(ICON_DEFS[name]).toDataURL());
}

// icon sizes: ≥20 px at z14, ~30 px at z16 (44 px source)
const AMENITY_SIZE = ["interpolate", ["linear"], ["zoom"], 11.5, 0.34, 13, 0.46, 14, 0.5, 16, 0.68];
const STOP_SCALE = ["match", ["get", "service_class"], "ghost", 0.62, "low", 0.82, 1];
// zoom must be the top-level input to interpolate — multiply per stop, not around it
const STOP_SIZE = ["interpolate", ["linear"], ["zoom"],
  11.5, ["*", 0.36, STOP_SCALE], 13, ["*", 0.5, STOP_SCALE], 14, ["*", 0.54, STOP_SCALE],
  16, ["*", 0.7, STOP_SCALE]];

const NOT_CLUSTER = ["literal", true];   // (no clustering any more)
// points and the walking range both start at street scale
export const DETAIL_ZOOM = 13.5;
export function addIconLayers(map) {
  if (map.getLayer("amenity-icons")) return;
  const before = "focus-mask";
  map.addLayer({
    id: "amenity-icons", type: "symbol", source: "points", minzoom: DETAIL_ZOOM,
    filter: ["all", NOT_CLUSTER, ["in", ["get", "t"], ["literal", ["school", "park", "toilet"]]]],
    layout: {
      "icon-image": ["match", ["get", "t"], "school", "ic-school", "toilet", "ic-toilet", "ic-park"],
      "icon-size": AMENITY_SIZE,
      "icon-allow-overlap": true, "icon-ignore-placement": true,
    },
  }, before);
  // single-select "other amenity" overlay (tier-2, from the tiles), confined to
  // the pinned range. Starts hidden (matches nothing).
  map.addLayer({
    id: "amenity-extra", type: "symbol", source: "amenities", "source-layer": "amenities",
    minzoom: 13,
    filter: ["==", ["get", "category"], "__none__"],
    layout: {
      "icon-image": "ic-other",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11.5, 0.3, 13, 0.44, 16, 0.6],
      "icon-allow-overlap": true, "icon-ignore-placement": true,
    },
  }, before);
  map.addLayer({
    id: "stop-icons", type: "symbol", source: "points", minzoom: DETAIL_ZOOM,
    filter: ["all", NOT_CLUSTER, ["in", ["get", "t"], ["literal", ["bus", "metro", "mmts"]]]],
    layout: {
      "icon-image": ["match", ["get", "t"], "metro", "ic-metro", "mmts", "ic-mmts", "ic-bus"],
      "icon-size": STOP_SIZE,
      "icon-allow-overlap": true, "icon-ignore-placement": true,
    },
    paint: { "icon-opacity": ["match", ["get", "service_class"], "ghost", 0.45, "low", 0.75, 1] },
  }, before);
  if (IS_TOUCH) {   // phones: invisible 44 px tap targets over every icon
    map.addLayer({ id: "amenity-hit", type: "circle", source: "points", minzoom: DETAIL_ZOOM,
      filter: ["all", NOT_CLUSTER, ["in", ["get", "t"], ["literal", ["school", "park", "toilet"]]]],
      paint: { "circle-radius": 22, "circle-opacity": 0 } }, "amenity-icons");
    map.addLayer({ id: "stop-hit", type: "circle", source: "points", minzoom: DETAIL_ZOOM,
      filter: ["all", NOT_CLUSTER, ["in", ["get", "t"], ["literal", ["bus", "metro", "mmts"]]]],
      paint: { "circle-radius": 22, "circle-opacity": 0 } }, "amenity-icons");
  }
  for (const l of ["amenity-icons", "stop-icons"]) {
    map.on("mouseenter", l, () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", l, () => map.getCanvas().style.cursor = "");
  }
  loadPoints(map);
}

// all headline points, kept in memory for the callouts and the "Show on map" filter
export let POINTS = [];
async function loadPoints(map) {
  try {
    const r = await fetch(`${DATA_URL}/${endpoints.points || "data/points.geojson"}`);
    POINTS = (await r.json()).features;
  } catch { POINTS = []; }
  applyPointFilter(map);
  window.dispatchEvent(new CustomEvent("walkatlas:points"));
}
// "Show on map" toggles filter the data itself
const SHOW_T = { stops: ["bus", "metro", "mmts"], school: ["school"], park: ["park"], public_toilet: ["toilet"] };
// Compare areas: the chosen "Show" layer decides which points draw
const LAYER_T = { near_transit: ["bus", "metro", "mmts"], near_bus_stop: ["bus"], near_metro: ["metro"], near_mmts: ["mmts"],
  near_school: ["school"], near_parks_play: ["park"], near_public_toilet: ["toilet"] };
export function applyPointFilter(map) {
  const src = map.getSource("points");
  if (!src) return;
  let allow;
  if (window._view === "maps") allow = new Set(LAYER_T[window._activeLayer] || []);
  else {
    const on = new Set(window._showKeys || Object.keys(SHOW_T));
    allow = new Set(Object.entries(SHOW_T).flatMap(([k, ts]) => on.has(k) ? ts : []));
  }
  src.setData({ type: "FeatureCollection", features: POINTS.filter((f) => allow.has(f.properties.t)) });
}

// "Colour streets" — a list of options, each with its own key; no separate legend
function keyHTML(st) {
  return st.cats
    ? `<span class="rv-sw">` + st.cats.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join("") + `</span>`
    : `<span class="rv-grad"><i style="background:${st.grad}"></i><span class="rv-lohi"><span>${st.lo}</span><span>${st.hi}</span></span></span>`;
}
function buildRoadViz(map) {
  const list = document.getElementById("rv-list");
  if (!list) return;
  list.innerHTML = ROAD_ORDER.map((k) =>
    `<button type="button" class="dd-opt" role="menuitemradio" data-key="${k}">${ROAD_STYLES[k].label}</button>`).join("");
  const apply = (k) => {
    const st = ROAD_STYLES[k];
    try { map.setPaintProperty("streets", "line-color", st.color); }
    catch { setTimeout(() => apply(k), 200); return; }   // style not ready yet
    window._roadViz = k;
    list.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", b.dataset.key === k);
      b.setAttribute("aria-checked", String(b.dataset.key === k));
    });
    const v = document.getElementById("tb-colour-val");
    if (v) v.textContent = st.label;
    const lg = document.getElementById("lg-road");   // the key lives in the legend
    if (lg) lg.innerHTML = `<div class="lg-bandtitle">Streets · ${st.label}</div>` + keyHTML(st);
  };
  list.querySelectorAll("button").forEach((b) =>
    b.onclick = (e) => { e.stopPropagation(); apply(b.dataset.key); list.hidden = true;
      list.previousElementSibling?.setAttribute("aria-expanded", "false"); });
  window.addEventListener("walkatlas:reapplyroads", () => { if (window._view !== "transit") apply(window._roadViz || ROAD_DEFAULT); });
  apply(ROAD_DEFAULT);
}

// "Show on map" checkboxes (Explore): amenity categories filter the icon layer
// (via walkshed.js, which owns that layer's filters); stops + wards toggle
// layer visibility directly. Only applied while Explore is the active view.
function buildShowLayers(map) {
  const boxes = [...document.querySelectorAll("#show-layers input[type=checkbox]")];
  if (!boxes.length) return;
  const AMENITY = { school: ["school"], park: ["park", "playground"], public_toilet: ["public_toilet"] };
  const vis = (id, yes) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", yes ? "visible" : "none");
  const apply = () => {
    const on = new Set(boxes.filter((b) => b.checked).map((b) => b.dataset.show));
    window._showCats = Object.entries(AMENITY).flatMap(([k, cats]) => on.has(k) ? cats : []);
    window._showKeys = [...on];
    applyPointFilter(map);
    window._showStops = on.has("stops");
    window._showWards = on.has("wards");
    if (window._view && window._view !== "explore") return;   // other views manage their own layers
    try {
      vis("wards", window._showWards);
    } catch { setTimeout(apply, 200); return; }
    window.dispatchEvent(new CustomEvent("walkatlas:showlayers"));
  };
  boxes.forEach((b) => b.onchange = apply);
  // re-apply when a view switch has flipped the stop layers back on
  window.addEventListener("walkatlas:showlayers", () => {
    try {
      const ex = window._view === "explore", tr = window._view === "transit", cm = window._view === "maps";
      // Walk from here + Bus & Metro show all points; Bus & Metro swaps the stop
      // icons for bigger discs; Compare areas shows only the chosen layer's points
      for (const l of ["amenity-icons", "amenity-hit"]) vis(l, ex || tr || cm);
      for (const l of ["stop-icons", "stop-hit"]) vis(l, ex || cm);
      vis("stops", tr);
      vis("wards", ex ? !!window._showWards : true);
      applyPointFilter(map);
    } catch { /* style not ready */ }
  });
  apply();
}

// Wards "Show" — a native select (compact, keyboard + screen-reader friendly)
function buildSwitcher(map, initial) {
  const sel = document.getElementById("ls-select");
  if (!sel) return;
  const keys = Object.keys(ACCESS_LAYERS);
  const start = initial && ACCESS_LAYERS[initial] ? initial : "none";
  sel.innerHTML = keys.map((k) => `<option value="${k}">${ACCESS_LAYERS[k].label}</option>`).join("");
  let current = start;   // what was last asked for, even while the style loads
  const apply = (val) => {
    current = val;
    try {
      for (const k of keys) {
        if (k === "none") continue;
        map.setLayoutProperty(`r-${k}`, "visibility", k === val ? "visible" : "none");
      }
    } catch { setTimeout(() => apply(val), 250); return; }  // style not ready yet
    window._activeLayer = val === "none" ? null : val;
    sel.value = val;
    document.getElementById("legend-bands").classList.toggle("hidden", !val.startsWith("near_"));
    applyPointFilter(map);
    window.dispatchEvent(new CustomEvent("walkatlas:coverlayer", { detail: window._activeLayer }));
  };
  sel.onchange = () => apply(sel.value);
  sel.onclick = (e) => e.stopPropagation();
  window.addEventListener("walkatlas:clearlayer", () => apply("none"));
  // entering Wards with nothing chosen → default to public transport
  window.addEventListener("walkatlas:coverdefault", () => {
    if (current === "none") apply("near_transit");
  });
  apply(start);
}
