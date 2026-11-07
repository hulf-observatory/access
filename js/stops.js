// Stop clicks: in Explore → pin the walking range there; in Bus & Metro → the
// stop's routes + reach colouring (transit.js).
import { CATEGORY_LABELS, SERVICE_CLASS, MODE_COLORS } from "../config.js";
import { IS_TOUCH } from "./map.js";

const clean = (v) => v && v !== "nan" ? v : null;

// amenity icon / dot click → pin the walkshed there, with a category + name header.
// Only schools & parks/play get a standalone report; toilets + tier-2 overlay
// pins are report-less (noReport hides the "Full report" button in the panel).
const REPORTABLE = new Set(["school", "park", "playground"]);
function amenityClick(f) {
  if (window._view !== "explore") return;   // PoI pins only in Explore
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  window.dispatchEvent(new CustomEvent("walkatlas:pinat", { detail: {
    lng, lat, place: { category: CATEGORY_LABELS[p.category] || p.category,
      name: clean(p.name) || CATEGORY_LABELS[p.category] || p.category,
      cat: p.category,
      noReport: !REPORTABLE.has(p.category) } } }));
}

// transit stop click → Bus & Metro view opens its schedule; in Explore pin the
// walkshed with a name header + a "see routes" link.
let _lastStop = null, _lastStopT = 0;
function stopClick(map, f) {
  if (window._view === "transit") {
    import("./transit.js").then(({ stopClickTransit }) => stopClickTransit(map, f));
    return;
  }
  if (window._view !== "explore") return;   // no walkshed pin from the Wards map
  const sid = f.properties.stop_id, now = Date.now();
  if (sid === _lastStop && now - _lastStopT < 350) return;   // dedupe circle+icon layers
  _lastStop = sid; _lastStopT = now;
  const { stop_name, mode, service_class, peak_only, trips_per_day } = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const kind = mode === "metro" ? "Metro station" : mode === "mmts" ? "MMTS station" : "Bus stop";
  let service = "";
  if (mode === "bus") {
    const sc = SERVICE_CLASS[service_class];
    if (sc) service = `${sc.label} service · ${trips_per_day} buses a day${peak_only ? " · rush hour only" : ""}`;
  } else if (mode === "mmts") service = "Timetable from 2019";
  window.dispatchEvent(new CustomEvent("walkatlas:pinat", { detail: {
    lng, lat, place: { category: kind, kind, service, name: clean(stop_name) || "Stop",
      cat: mode === "bus" ? "bus_stop" : mode,
      transit: { props: f.properties, coords: [lng, lat] } } } }));
}

const STOP_COLOR = ["match", ["get", "mode"],
  "metro", MODE_COLORS.metro, "mmts", MODE_COLORS.mmts, MODE_COLORS.bus];

export function clearReach(map) {
  map.setPaintProperty("stops", "circle-color", STOP_COLOR);
  map.setPaintProperty("stops", "circle-opacity", 1);
  window._reachFrom = null;
}

export function initStops(map) {
  // stop click works on the circle AND the icon (the icon is larger than the
  // tiny hit-circle, so binding only to "stops" missed clicks on the disc);
  // on phones the invisible 44 px "stop-hit" discs are bound too. Layers that
  // don't exist yet (added after load) are bound lazily by MapLibre.
  for (const lyr of ["stops", "stop-icons", ...(IS_TOUCH ? ["stop-hit"] : [])])
    map.on("click", lyr, (e) => stopClick(map, e.features[0]));

  // clicking anywhere that's not a stop clears route highlight + reach view
  // (in transit view, route/walkshed state is managed by its own clear link)
  map.on("click", (e) => {
    const onStop = map.queryRenderedFeatures(e.point,
      { layers: ["stops", "stop-icons", "stop-hit"].filter((l) => map.getLayer(l)) }).length;
    if (window._view === "transit") return;
    if (!onStop) {
      map.setFilter("route-hl", ["==", "route_id", ""]);
      if (window._reachFrom) clearReach(map);
    }
  });

  for (const lyr of ["stops", "stop-icons", "amenity-icons", "amenity-extra"]) {
    map.on("mouseenter", lyr, () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", lyr, () => map.getCanvas().style.cursor = "");
  }

  // amenity icon click (schools / parks / toilets / tier-2 overlay) → pin here
  for (const lyr of ["amenity-icons", "amenity-extra", ...(IS_TOUCH ? ["amenity-hit"] : [])])
    map.on("click", lyr, (e) => amenityClick(e.features[0]));
}
