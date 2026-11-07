// Scope breadcrumb, bottom-left: Hyderabad › Corporation › Ward (zones skipped).
// Selecting a place moves the camera and outlines the area. It never filters,
// hides or dims anything. The Wards card reads the same selection.
//
// State is exactly four values; renderCrumb() rebuilds the whole bar from them
// on every change, so the bar cannot drift out of step with the camera.
import { getSummaries, setScope } from "./panel.js";
import { highlightSelected } from "./map.js";

const ST = { level: 0, corp: null, zone: null, ward: null };   // 0 city · 1 corp · 2 zone · 3 ward
let S = null, map = null, openList = null;                     // openList: "corp" | "zone" | "ward" | null

const CITY = "Hyderabad";
const wardNo = (k) => String(Math.round(+k));
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const byName = (a, b) => a[0].localeCompare(b[0]);

// ---- indexes (from summaries.json) ------------------------------------------
const corps = () => Object.entries(S.corporations).filter(([k]) => k).sort(byName);
const zones = (corp) => Object.entries(S.zones).filter(([k, z]) => k && z.corporation === corp).sort(byName);
const wards = (corp) => Object.entries(S.wards)
  .filter(([, w]) => w.name && w.corporation === corp)
  .sort((a, b) => a[1].name.localeCompare(b[1].name));

// ---- camera -----------------------------------------------------------------
function fit(bbox, city = false) {
  if (!bbox || !map) return;
  const desktop = matchMedia("(min-width: 769px)").matches;
  const card = desktop && !document.getElementById("panel").classList.contains("empty") ? 380 : 0;
  // the city view keeps clear of the toolbar (top), the breadcrumb + legend
  // (bottom) and the detail card (right); a unit gets even padding
  const padding = city
    ? { top: 72, bottom: desktop ? 120 : 60, left: 40, right: 40 + card }
    : { top: 60, bottom: 60, left: 60, right: 60 + card };
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding, duration: 900, maxZoom: 15.5 });
}

// ---- select (used by the bar and by map clicks) -----------------------------
function commit(bbox, city) {
  openList = null;
  renderCrumb();
  setScope({ corp: ST.corp, zone: ST.zone, ward: ST.ward });
  highlightSelected(ST.ward ? { level: "wards", key: ST.ward, unit: S.wards[ST.ward] }
    : ST.zone ? { level: "zones", key: ST.zone, unit: S.zones[ST.zone] }
    : ST.corp ? { level: "corporations", key: ST.corp, unit: S.corporations[ST.corp] } : null);
  fit(bbox, city);
}
export function selectCity() {
  if (!S) return;
  Object.assign(ST, { level: 0, corp: null, zone: null, ward: null });
  commit(S.extent.bbox, true);
}
export function selectCorp(name) {
  if (!S) return;
  const c = S.corporations[name];
  if (!c) return selectCity();
  Object.assign(ST, { level: 1, corp: name, zone: null, ward: null });   // clears any zone / ward
  commit(c.bbox);
}
export function selectZone(name) {
  if (!S) return;
  const z = S.zones[name];
  if (!z) return ST.corp ? selectCorp(ST.corp) : selectCity();
  Object.assign(ST, { level: 2, corp: z.corporation, zone: name, ward: null });
  commit(z.bbox);
}
export function selectWard(no) {
  if (!S) return;
  const key = Object.keys(S.wards).find((k) => wardNo(k) === wardNo(no));
  const w = key && S.wards[key];
  if (!w) return ST.corp ? selectCorp(ST.corp) : selectCity();         // not found → its parent
  Object.assign(ST, { level: 3, corp: w.corporation, zone: w.zone, ward: key });
  commit(w.bbox);
}

// ---- render -----------------------------------------------------------------
function listHTML(kind) {
  let head, reset, rows, cur;
  if (kind === "corp") {
    head = "Switch corporation"; reset = `All of ${CITY}`; cur = ST.corp;
    rows = corps().map(([k]) => [k, k]);
  } else {
    head = "Switch ward"; reset = `All of ${ST.corp}`; cur = ST.ward;
    rows = wards(ST.corp).map(([k, w]) => [k, `${w.name} · Ward ${wardNo(k)}`]);
  }
  return `<div class="crumb-list" role="dialog" aria-label="${head}">
    <div class="crumb-lh">${head}</div>
    <button type="button" class="crumb-opt${cur ? "" : " on"}" data-kind="${kind}" data-v="">${esc(reset)}</button>
    ${rows.map(([v, l]) => `<button type="button" class="crumb-opt${v === cur ? " on" : ""}"
      data-kind="${kind}" data-v="${esc(v)}">${esc(l)}</button>`).join("")}
  </div>`;
}

// one part = name button (+ caret when it has a list)
function part({ label, level, kind, placeholder }) {
  const current = !placeholder && ST.level === level;
  const cls = `crumb-name${current ? " cur" : ""}${placeholder ? " ph" : ""}`;
  const name = `<button type="button" class="${cls}" data-level="${level}" ${kind ? `data-kind="${kind}"` : ""}
    ${current ? 'aria-current="true"' : ""} title="${esc(label)}">${esc(label)}</button>`;
  const caret = kind ? `<button type="button" class="crumb-caret" data-kind="${kind}"
    aria-label="Switch ${kind === "corp" ? "corporation" : kind}" aria-expanded="${openList === kind}">▾</button>` : "";
  return `<span class="crumb-part">${name}${caret}${openList === kind ? listHTML(kind) : ""}</span>`;
}

export function renderCrumb() {
  const bar = document.getElementById("crumb");
  if (!bar || !S) return;                       // nothing until the indexes load
  const sep = `<span class="crumb-sep" aria-hidden="true">›</span>`;
  const parts = [part({ label: CITY, level: 0 })];
  parts.push(part({ label: ST.corp || "All corporations", level: 1, kind: "corp", placeholder: !ST.corp }));
  if (ST.corp && wards(ST.corp).length)
    parts.push(part({ label: ST.ward ? S.wards[ST.ward].name : "All wards", level: 3, kind: "ward", placeholder: !ST.ward }));
  else if (ST.corp)   // e.g. Secunderabad Cantonment: mapped as one area
    parts.push(`<span class="crumb-note">No wards here</span>`);
  bar.innerHTML = parts.join(sep);
  bar.hidden = false;
  // the lists open upward into the legend's space: tuck the legend away meanwhile
  document.getElementById("legend")?.classList.toggle("tucked", !!openList);
  const on = bar.querySelector(".crumb-opt.on");
  if (on) on.scrollIntoView({ block: "nearest" });
}

function toggleList(kind) {
  openList = openList === kind ? null : kind;
  renderCrumb();
}

// ---- init -------------------------------------------------------------------
export async function initCrumb(m) {
  map = m;
  S = await getSummaries();
  const bar = document.getElementById("crumb");
  if (!S || !bar) return;

  bar.addEventListener("click", (e) => {
    e.stopPropagation();                        // never falls through to the map / document
    const opt = e.target.closest(".crumb-opt");
    if (opt) {
      const v = opt.dataset.v, k = opt.dataset.kind;
      if (k === "corp") v ? selectCorp(v) : selectCity();
      else v ? selectWard(v) : selectCorp(ST.corp);
      return;
    }
    const caret = e.target.closest(".crumb-caret");
    if (caret) return toggleList(caret.dataset.kind);
    const name = e.target.closest(".crumb-name");
    if (!name) return;
    if (name.classList.contains("ph")) return toggleList(name.dataset.kind);   // placeholder → its list
    const lv = +name.dataset.level;
    if (lv === ST.level) { if (openList) { openList = null; renderCrumb(); } return; }
    if (lv === 0) selectCity();
    else if (lv === 1) selectCorp(ST.corp);
  });
  for (const ev of ["mousedown", "dblclick", "wheel", "touchstart"])
    bar.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  document.addEventListener("click", () => { if (openList) { openList = null; renderCrumb(); } });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openList) { openList = null; renderCrumb(); }
  });
  window.addEventListener("walkatlas:resetscope", selectCity);

  // map clicks feed the same state (Wards + Bus & Metro; Explore clicks pin).
  // Feature layers win; otherwise the area under the pointer, by zoom.
  map.on("click", (e) => {
    if (window._view !== "maps") return;   // Compare areas only; elsewhere the map has its own clicks
    const feats = ["stops", "stop-icons", "stop-hit", "amenity-icons", "amenity-extra"]
      .filter((l) => map.getLayer(l) && map.getLayoutProperty(l, "visibility") !== "none");
    if (feats.length && map.queryRenderedFeatures(e.point, { layers: feats }).length) return;
    if (!map.getLayer("ward-pick")) return;
    const hit = map.queryRenderedFeatures(e.point, { layers: ["ward-pick"] })[0];
    if (!hit) return;
    const p = hit.properties, z = map.getZoom();
    if (z >= 12) selectWard(p.ward_no);
    else selectCorp(p.corporation);
  });

  renderCrumb();
}
