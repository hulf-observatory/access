// Accessibility Atlas — boot, hash state, mobile sheet, help modal.
import { START, START_ZOOM_MOBILE, DATA_URL, inCore } from "../config.js";
import { initMap } from "./map.js";
import { initWalkshed } from "./walkshed.js";
import { initStops } from "./stops.js";
import { initSearch } from "./search.js";
import { renderHome, renderAccessView } from "./panel.js";
import { initCrumb } from "./crumb.js";
import { enterTransit, exitTransit, stopClickTransit } from "./transit.js";
import { writeHash, parseHash } from "./hash.js";
import { cellToLatLng } from "../vendor/h3-js.js";
import { initStart } from "./start.js";
import { initMobile } from "./mobile.js";

// A URL hash is a link when it names its tab (written by Share or a pinned
// spot) or, in the old form without a tab, points at a pinned spot or a City
// layer. An old bare view (left over from an old visit) is dropped, so the
// landing card and a fresh random spot come back.
let hash = parseHash();
if (hash.legacy && !hash.cell && !hash.layer) {
  hash = {};
  history.replaceState(null, "", location.pathname + location.search);
}
// no link, no location: open on a random spot in the city, so every visit
// starts on a different street. A random point inside a random ward's box:
// wards are all built-up, so it never lands in open country.
// core wards only (centre within CORE_RADIUS_KM of the city centre): the outskirts
// have big wards with lakes and open land, and a first view there says little
let wardBoxes = [];
try {
  const s = await (await fetch(`${DATA_URL}/data/summaries.json`)).json();
  wardBoxes = Object.values(s.wards).filter((w) => w.bbox
    && inCore([(w.bbox[0] + w.bbox[2]) / 2, (w.bbox[1] + w.bbox[3]) / 2])).map((w) => w.bbox);
} catch { /* keep the default centre */ }
const randomSpot = () => {
  if (!wardBoxes.length) return START.center;
  const [x0, y0, x1, y1] = wardBoxes[Math.floor(Math.random() * wardBoxes.length)];
  return [x0 + Math.random() * (x1 - x0), y0 + Math.random() * (y1 - y0)];
};
// close enough for points and the rings to draw (13.5+), far enough that the
// whole 15-minute range fits on screen with room around it
const EXPLORE_ZOOM = matchMedia("(max-width: 768px)").matches ? 13.7 : 14.1;
if (!hash.center) { START.center = randomSpot(); START.zoom = EXPLORE_ZOOM; }
const map = await initMap(hash);
window._map = map;   // debug/console access

// wake the renderer whenever the container or tab visibility changes —
// maps constructed in hidden/zero-size tabs otherwise stay blank
new ResizeObserver(() => map.resize())
  .observe(document.getElementById("map"));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) map.resize();
});
initWalkshed(map);
initStops(map);
initSearch(map);

// ---- views: explore (Explore) | maps (Wards) | transit (Bus & Metro) — keys are internal ----
window._view = "explore";
const tabs = document.querySelectorAll("#view-tabs button");

// On phones the section controls (street colour / layers / Show) move into the
// top of the bottom sheet; on desktop they live in the toolbar popovers. The
// sheet-controls container hides in views that expose none of them.
const mq = matchMedia("(max-width: 768px)");
const sheetControls = document.getElementById("sheet-controls");
const panelEl = document.getElementById("panel");
// order inside the sheet on phones; on desktop each goes back to its own slot
const MOBILE_CTRLS = ["road-viz", "show-layers", "layer-switcher"];   // phones: moved into the sheet
function placeControls() {
  MOBILE_CTRLS.forEach((id) => {
    const el = document.getElementById(id);
    const dest = mq.matches ? sheetControls : document.getElementById("ctrlpanel");
    if (el && dest && el.parentElement !== dest) dest.appendChild(el);
  });
}
function refreshSheetControls() {
  sheetControls.hidden = !MOBILE_CTRLS.some((id) => {
    const el = document.getElementById(id);
    return el && el.parentElement === sheetControls
      && getComputedStyle(el).display !== "none";
  });
}
placeControls();

// dropdown strip: one menu open at a time; outside click / Escape close
const dds = [...document.querySelectorAll("#ctrlpanel .dd")];
function closePops() {
  dds.forEach((d) => { const m = d.querySelector(".dd-menu"); if (m) { m.hidden = true;
    d.querySelector(".dd-btn").setAttribute("aria-expanded", "false"); } });
}
dds.forEach((d) => {
  const btn = d.querySelector(".dd-btn"), menu = d.querySelector(".dd-menu");
  if (!menu) return;
  btn.onclick = (e) => { e.stopPropagation(); const open = menu.hidden; closePops();
    if (open) { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); } };
  menu.addEventListener("click", (e) => e.stopPropagation());
});
document.addEventListener("click", closePops);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePops(); });
const clearLayer = () => window.dispatchEvent(new CustomEvent("walkatlas:clearlayer"));
// grey plain streets for Coverage; retries until the style is ready, and bails
// if the view changed in the meantime
function greyStreets() {
  if (window._view !== "maps") return;
  try { map.setPaintProperty("streets", "line-color", "#6f6b62"); }
  catch { setTimeout(greyStreets, 200); }
}
let booted = false;
function setView(v) {
  const prev = window._view;
  // re-clicking the tab you are on does nothing (it used to wipe the pinned card)
  if (v === prev && document.body.dataset.view === v) return;
  window._view = v;
  // a link is for the tab it was made on; changing tab drops it (City writes its own on the next move)
  if (booted && location.hash.length > 1) history.replaceState(null, "", location.pathname + location.search);
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === v));
  document.body.dataset.view = v;      // CSS shows the right toolbar buttons + legend rows
  closePops();
  const withLayers = v === "maps" ? "none" : "";   // Street + Transit
  document.getElementById("road-viz").style.display = v === "explore" ? "" : "none";   // street colour: Street only
  document.getElementById("show-layers").style.display = withLayers;   // map layer toggles
  document.getElementById("layer-switcher").style.display = v === "maps" ? "" : "none";
  // desktop: the detail card floats over the map and hides while Explore has
  // nothing pinned; City and Transit always have panel content
  panelEl.classList.toggle("empty", v === "explore" && !window._pinnedCell);
  window.dispatchEvent(new CustomEvent("walkatlas:showlayers"));        // re-apply toggles
  window.dispatchEvent(new CustomEvent("walkatlas:viewchange", { detail: v }));
  // Bus & Metro colours the stop discs by travel time — hide the icons there
  if (v !== "explore") window.dispatchEvent(new CustomEvent("walkatlas:unpin"));
  if (prev === "transit" && v !== "transit") { exitTransit(map); document.getElementById("transit-notice").hidden = true; }
  // each section has its own card: Walk from here shows the rings card on entry,
  // Bus & Metro its notice; Compare areas none for now
  const startSheet = document.getElementById("start-sheet");
  if (startSheet) {
    if (v !== "explore") startSheet.hidden = true;
    else if (prev && prev !== "explore") {   // first load is start.js's call
      startSheet.hidden = false;
      map.jumpTo({ center: randomSpot(), zoom: EXPLORE_ZOOM });   // a fresh street each time
      window.dispatchEvent(new CustomEvent("walkatlas:previewcentre"));
    }
  }
  // Compare areas: the whole city, its summary, and a card showing where to pick an area
  const compareNotice = document.getElementById("compare-notice");
  if (compareNotice) {
    compareNotice.hidden = v !== "maps";
    if (v === "maps") window.dispatchEvent(new CustomEvent("walkatlas:resetscope"));
  }
  if (v !== "maps") clearLayer();
  // Wards: streets become a plain grey overlay so the choropleth reads;
  // other views restore the coloured "Colour streets by" styling
  if (v === "maps") greyStreets();
  else window.dispatchEvent(new CustomEvent("walkatlas:reapplyroads"));
  if (v === "maps") {
    window.dispatchEvent(new CustomEvent("walkatlas:coverdefault"));  // default layer
    renderAccessView();
  } else if (v === "transit") enterTransit(map);
  else renderHome(v);
  refreshSheetControls();
  window.dispatchEvent(new CustomEvent("walkatlas:showlayers"));   // final say on layer visibility
}
document.querySelector("#compare-notice button").onclick = () => {
  document.getElementById("compare-notice").hidden = true; };
const aboutPage = document.getElementById("about-page");
const openHelp = () => { aboutPage.hidden = false; aboutPage.scrollTop = 0; };
document.getElementById("about-close").onclick = () => { aboutPage.hidden = true; };
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { aboutPage.hidden = true; document.getElementById("compare-notice").hidden = true; }
});
tabs.forEach((t) => t.onclick = () => setView(t.dataset.view));
document.getElementById("btn-about").onclick = openHelp;

// Share = copy the current URL (hash carries tab / zoom / centre / layer or pinned cell)
const shareBtn = document.getElementById("btn-share");
shareBtn.onclick = async () => {
  writeHash(map, window._activeLayer, window._pinnedCell);   // the link carries the view
  let ok = false;
  try { await navigator.clipboard.writeText(location.href); ok = true; }
  catch {
    // older browsers / no focus: copy through a throwaway text field
    const ta = document.createElement("textarea");
    ta.value = location.href; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
  }
  const msg = shareBtn.querySelector(".share-msg");
  msg.textContent = ok ? "Link copied" : "Copy failed"; msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 1600);
};
document.getElementById("brandHome").onclick = () => setView("explore");
initCrumb(map);       // bottom-left breadcrumb: Hyderabad › Corporation › Zone › Ward
setView(hash.view || "explore");
booted = true;
// a link opens on its tab at its zoom and centre: entering City or Transit
// moves the map, so put it back; a pinned Street spot is pinned again
if (hash.center) map.jumpTo({ center: hash.center, zoom: hash.zoom });
if (hash.cell && hash.view === "explore") {
  try {
    const [lat, lng] = cellToLatLng(hash.cell);
    const pin = () => window.dispatchEvent(new CustomEvent("walkatlas:pinat", { detail: { lng, lat } }));
    if (map.getSource("walkshed-pin")) pin(); else map.once("load", pin);
  } catch { /* not a cell id */ }
}

// ---- URL hash: #tab/z/lat/lng[/layer or cell] (hash.js) ----------------------
// The hash is written only when there is something to come back to (a pinned
// spot, or a Share click), not on every pan. Otherwise a reload would reopen
// the same spot and skip the landing card.
map.on("moveend", () => { if (window._pinnedCell || window._activeLayer) writeHash(map, window._activeLayer, window._pinnedCell); });

// ---- reset (per section) / help / legend ---------------------------------------
document.getElementById("btn-reset").onclick = () => {
  const v = window._view;
  window.dispatchEvent(new CustomEvent("walkatlas:unpin"));
  window.dispatchEvent(new CustomEvent("walkatlas:extraamenity", { detail: null }));  // clear overlay
  if (v !== "explore")                       // breadcrumb back to all of Hyderabad
    window.dispatchEvent(new CustomEvent("walkatlas:resetscope"));
  if (v === "maps") {                         // layer→none
    clearLayer();
  } else if (v === "transit") {               // clear selected stop/route
    exitTransit(map); enterTransit(map);
  }
  map.flyTo({ ...START });
};
// "Explore in Public Transport" from a stop summary → switch tab + open the stop
window.addEventListener("walkatlas:opentransitstop", (e) => {
  const { props, coords } = e.detail;
  setView("transit");
  map.flyTo({ center: coords, zoom: 15 });
  stopClickTransit(map, { properties: props, geometry: { type: "Point", coordinates: coords } });
});

// pinned "Full report" button → fit the map to the walkshed extent, open the
// report with the place / ward names so the report can say where it is
window.addEventListener("walkatlas:report", (e) => {
  const cell = window._pinnedCell;
  if (!cell) return;
  const { place, ward } = e.detail || {};
  const q = new URLSearchParams({ cell });
  if (place?.name) q.set("name", place.name);
  if (place?.cat) q.set("cat", place.cat);
  if (ward?.ward) q.set("ward", `${ward.ward} (Ward ${ward.ward_no})${ward.zone ? ", " + ward.zone + " zone" : ""}`);
  const fc = map.getSource("walkshed-pin")?._data;
  if (fc?.features?.length) {
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    const scan = (c) => Array.isArray(c[0]) ? c.forEach(scan)
      : (x0 = Math.min(x0, c[0]), y0 = Math.min(y0, c[1]),
         x1 = Math.max(x1, c[0]), y1 = Math.max(y1, c[1]));
    fc.features.forEach((f) => scan(f.geometry.coordinates));
    if (x0 <= x1) map.fitBounds([[x0, y0], [x1, y1]], { padding: 60, maxZoom: 16 });
  }
  window.open(`report.html?${q}`, "_blank");
});

// card scroll cue: a fade + "More below" while there is more to scroll
const panelBody = document.getElementById("panel-body");
const cue = document.getElementById("scroll-cue");
const cueTop = document.getElementById("scroll-cue-top");
const syncCue = () => {
  cue.hidden = panelBody.scrollHeight - panelBody.scrollTop - panelBody.clientHeight < 12;
  cueTop.hidden = panelBody.scrollTop < 80;
};
panelBody.addEventListener("scroll", syncCue, { passive: true });
new MutationObserver(() => requestAnimationFrame(syncCue)).observe(panelBody, { childList: true, subtree: true, attributes: true });
new ResizeObserver(syncCue).observe(panelBody);
cue.onclick = () => panelBody.scrollBy({ top: panelBody.clientHeight * 0.7, behavior: "smooth" });
cueTop.onclick = () => panelBody.scrollTo({ top: 0, behavior: "smooth" });

// legend: open by default on desktop, a collapsed chip on phones
const legendBox = document.getElementById("legend");
const legendToggle = document.getElementById("legend-toggle");
const syncLegend = () => {
  const c = legendBox.classList.contains("collapsed");
  legendToggle.querySelector(".lg-chev").textContent = c ? "▴" : "▾";
  legendToggle.setAttribute("aria-expanded", String(!c));
};
legendBox.classList.toggle("collapsed", mq.matches);
syncLegend();
legendToggle.onclick = () => { legendBox.classList.toggle("collapsed"); syncLegend(); };

// ---- mobile bottom sheet: everything phone-specific lives in mobile.js ------
initStart(map, mq);                          // landing card
initMobile(map, mq);                         // no-op on desktop
mq.addEventListener("change", () => { placeControls(); refreshSheetControls(); });
