// Accessibility Atlas frontend config.
// DATA_URL: folder holding endpoints.json + data/. Live: the observatory server (obs-mumbai,
// /srv/obs/www/access/). Local (dev-server.py): the same layout served at /_data.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
export const DATA_URL = LOCAL ? `${location.origin}/_data` : "https://api.urbanobservatory.in/access";
// Start view. Phones open closer (the streets + markers only draw from z13) — see START_ZOOM_MOBILE.
export const START = { center: [78.43, 17.425], zoom: 14 };
// Random opening spots (Street) and stops (Transit) come from inside this circle around
// the city centre (Hussain Sagar), so a visit never opens on the outskirts.
export const CORE_CENTRE = [78.474, 17.424];
export const CORE_RADIUS_KM = 7;
export const inCore = ([lng, lat]) => {
  const dx = (lng - CORE_CENTRE[0]) * 105.6, dy = (lat - CORE_CENTRE[1]) * 111.2;   // km at 17.4°N
  return Math.hypot(dx, dy) <= CORE_RADIUS_KM;
};
export const START_ZOOM_MOBILE = 15;
// Pan limit: Telangana state extent (≈ 77.27–81.32 E, 15.83–19.92 N) plus a small margin.
// Data covers HMDA only; the rest of the state shows the basemap. Keeps the camera in
// Telangana, avoids fetching basemap tiles for the rest of the world, and means disputed
// international boundaries can never be on screen. (HMDA bbox: 78.004,16.965 → 79.05,17.897)
export const MAX_BOUNDS = [[77.1, 15.7], [81.5, 20.05]];
// Basemap. BASEMAP_STYLE = a MapLibre vector style URL (OpenFreeMap Positron: free, no key,
// CORS-enabled, own fonts/sprites). Our data layers are inserted UNDER its label layers.
// If the style fetch fails (offline, provider down) the app falls back to the BASEMAP
// raster tiles. NOTE: CARTO now watermarks "KEY REQUIRED" without an API key (Sep 2026).
export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
export const BASEMAP =
  "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png";   // fallback only
export const H3_RES = 10;               // must match pipeline grid
export const CATEGORY_LABELS = {
  bus_stop: "Bus stop", metro: "Metro station", mmts: "MMTS station",
  school: "School", college: "College", anganwadi: "Anganwadi",
  healthcare: "Clinic / hospital", pharmacy: "Pharmacy", grocery: "Grocery",
  market: "Market", park: "Park", playground: "Playground",
  public_toilet: "Public toilet", community: "Community hall",
  bank_atm: "Bank / ATM / post",
};
// same categories as words in a sentence ("a bus stop", "an MMTS station")
export const CATEGORY_PHRASE = {
  bus_stop: "a bus stop", metro: "a metro station", mmts: "an MMTS station",
  school: "a school", anganwadi: "an anganwadi", park: "a park",
  playground: "a playground", public_toilet: "a public toilet",
};
// Wards view layers ("Show" picker). Rasters = walk time to the nearest X (Tier-1 only).
export const ACCESS_LAYERS = {
  none:               { label: "None" },
  near_transit:       { label: "Public transport" },
  near_bus_stop:      { label: "Bus stops" },
  near_metro:         { label: "Metro" },
  near_mmts:          { label: "MMTS suburban rail" },
  near_school:        { label: "Schools" },
  near_anganwadi:     { label: "Anganwadis" },
  near_parks_play:    { label: "Parks & playgrounds" },
  near_public_toilet: { label: "Public toilets" },
  shade:              { label: "Shade" },
  canopy:             { label: "Tree cover" },
};
// Bus-stop service classes (from 01b trips/day; see transit_classes.json).
// "ghost" (1–2/day) and any peak-only stub are excluded from access mapping.
export const SERVICE_CLASS = {
  frequent: { label: "Frequent", desc: "41+ buses a day", order: 0 },
  regular:  { label: "Regular",  desc: "11–40 buses a day", order: 1 },
  low:      { label: "Low",      desc: "3–10 buses a day", order: 2 },
  ghost:    { label: "Minimal",  desc: "1–2 buses a day", order: 3 },
};
// Walk-time bands: the raster tiles are painted with these in the pipeline (06b BANDS),
// so they cannot change here without a re-run. Role: "time to nearest", everywhere.
export const BAND_COLORS = [   // must match 06b BANDS
  ["under 5 min", "#3C9D8E"], ["5–10", "#B8DDC8"],
  ["10–15", "#EDDFA9"], ["over 15", "#E07B4F"]];
// Mode colours (fixed roles: bus / metro / MMTS). Never reused for anything else.
export const MODE_COLORS = { bus: "#B3261E", metro: "#185FA5", mmts: "#6A1B9A" };
// Walking range = ink, so it never competes with the mode or band colours.
export const WALK_COLOR = "#111827";
// Pinned-panel POI tiers (2026-07-11). TIER1 = nearest-time headline rows
// (each also has its own Access map). TIER2 = count-on-expansion only, no map.
export const TIER1 = {
  "Public transport": ["bus_stop", "metro", "mmts"],
  "Schools":          ["school"],
  "Parks & play":     ["park", "playground"],
  "Public toilets":   ["public_toilet"],
};
export const TIER2 = ["anganwadi", "healthcare", "pharmacy", "grocery",
                      "market", "bank_atm", "college", "community"];

// The disclaimer, shown on every card, the reports and the About page.
export const DISCLAIMER_TITLE = "Please read before using these numbers.";
export const DISCLAIMER = "This is a research tool under continuous development. The figures come from open data and automated models, and both can be wrong: amenities may be missing, misplaced or closed, street networks incomplete, and timetables out of date. Walk times are estimates for an average adult and will differ for children, older people and anyone with a disability. Check on the ground before relying on this for planning, funding or policy decisions. No warranty is given, and the Hyderabad Urban Observatory accepts no liability for decisions taken on the basis of it.";
export const DISCLAIMER_HTML = `<p class="hint caveat disclaimer"><b>${DISCLAIMER_TITLE}</b> ${DISCLAIMER}</p>`;
