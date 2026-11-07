// Detail panel rendering: per-view home states, Wards card (lead sentence, rank,
// headline bars, folds), pinned spot card (verdict first, four headline rows,
// the walk itself, what else is nearby). No abstract indices — nearest times,
// counts, and % coverage only.
import { DATA_URL, CATEGORY_LABELS, CATEGORY_PHRASE, TIER1, TIER2, BAND_COLORS, DISCLAIMER_HTML } from "../config.js";
import { endpoints, iconDataURL, IS_TOUCH } from "./map.js";

const body = () => document.getElementById("panel-body");
const panelEmpty = (yes) => document.getElementById("panel").classList.toggle("empty", !!yes);
let summaries = null;

export async function getSummaries() {
  if (summaries) return summaries;
  try {
    const r = await fetch(`${DATA_URL}/${endpoints.summaries || "data/summaries.json"}`, { cache: "no-cache" });
    summaries = r.ok ? await r.json() : null;
  } catch { summaries = null; }
  return summaries;
}

// the unit-level breakdown covers every metric (all categories)
const SUMMARY_CATS = ["bus_stop", "metro", "mmts", "school", "college", "anganwadi",
                      "park", "playground", "public_toilet", "healthcare",
                      "pharmacy", "grocery", "market", "community", "bank_atm"];
// "for bus stops" — rank / lead phrasing per category
const CAT_PLURAL = {
  bus_stop: "bus stops", metro: "metro stations", mmts: "MMTS stations",
  school: "schools", anganwadi: "anganwadis", park: "parks", playground: "playgrounds",
  public_toilet: "public toilets", healthcare: "clinics", pharmacy: "pharmacies",
  grocery: "groceries", market: "markets", community: "community halls", bank_atm: "banks",
};

// one row per amenity type: icon · name · count in the area · 5/10/15 bar · % within 15
export function amenityRows(cats, counts = {}, list = SUMMARY_CATS) {
  return list.filter((c) => cats[c]).map((c) => {
    const [p5, p10, p15] = cats[c];
    const segs = [[p5, BAND_COLORS[0][1]], [p10 - p5, BAND_COLORS[1][1]],
                  [p15 - p10, BAND_COLORS[2][1]], [100 - p15, BAND_COLORS[3][1]]]
      .map(([w, col]) => `<span class="seg" style="width:${Math.max(w, 0)}%;background:${col}"></span>`).join("");
    const n = counts[c] != null ? counts[c].toLocaleString() : "";
    return `<div class="amrow">
      <img class="ci" src="${iconDataURL(c)}" alt="">
      <span class="lbl">${CATEGORY_LABELS[c]}</span>
      <span class="n" title="in this area">${n}</span>
      <span class="track">${segs}</span>
      <span class="pct"><b>${Math.round(p15)}%</b></span></div>`;
  }).join("");
}

// stacked 5/10/15 bar: teal (≤5), green (5-10), tan (10-15); orange = over 15
function stackedBars(cats, list = SUMMARY_CATS) {
  return list.filter((c) => cats[c]).map((c) => {
    const [p5, p10, p15] = cats[c];
    // 4 segments = the same 4 map bands (≤5 · ≤10 · ≤15 · over-15 orange)
    const segs = [[p5, BAND_COLORS[0][1]], [p10 - p5, BAND_COLORS[1][1]],
                  [p15 - p10, BAND_COLORS[2][1]], [100 - p15, BAND_COLORS[3][1]]]
      .map(([w, col]) => `<span class="seg" style="width:${Math.max(w, 0)}%;
        background:${col}"></span>`).join("");
    return `<div class="stackbar"><span class="lbl">${CATEGORY_LABELS[c]}</span>
      <span class="track">${segs}</span>
      <span class="nums">${Math.round(p5)} · ${Math.round(p10)} ·
        <b>${Math.round(p15)}%</b></span></div>`;
  }).join("");
}

export function renderHome(view = "explore") {
  const phone = matchMedia("(max-width: 768px)").matches;
  const walk = phone
    ? `<b>Pin</b> to see your neighbourhood: everything within a 15 minute walk of this point.`
    : IS_TOUCH
    ? `<b>How walkable is this spot?</b> Tap anywhere on the map to see how far
       you can get on foot in 5, 10 or 15 minutes, and what you can reach. Tap a
       bus or metro stop for its routes.`
    : `<b>How walkable is this spot?</b> Move over the map to preview the walking
       range from any point. Click to pin it and see what is within reach.`;
  panelEmpty(view === "explore");   // desktop: hide the floating card until something is pinned
  body().innerHTML = view === "maps" ? `
  <div class="sec">
    <div class="sec-title">City</div>
    <p class="hint">Pick what to <b>show</b>: the city is coloured by walk time to
    the nearest one. Teal is close, orange is far.</p>
  </div>` : phone ? `<p class="verdict m-instr">${walk}</p>` : `
  <div class="sec">
    <div class="sec-title">Street</div>
    <p class="hint">${walk}</p>
  </div>`;
}

// ---- Wards section: scope drill-down + one card --------------------------
// The cascade (Corporation ▸ Zone ▸ Circle ▸ Ward) sets SCOPE; the deepest
// selected level is the "current unit".
let SCOPE = { corp: "", zone: "", circle: "", ward: "" };
const ACCESS_BAND = 15;   // coverage fixed at the 15-min band (no toggle)
// map the selected coverage layer → the summary category to break down by
// (combined layers use a representative category; shade/canopy have none)
export const CAT_FOR_LAYER = {
  near_bus_stop: "bus_stop", near_mmts: "mmts", near_metro: "metro",
  near_school: "school", near_anganwadi: "anganwadi",
  near_public_toilet: "public_toilet",
  near_transit: "bus_stop", near_parks_play: "park",
};

const LEVEL_LABEL = { extent: "Hyderabad (HMDA)", corporations: "Corporation",
                      zones: "Zone", circles: "Circle", wards: "Ward" };
const LEVEL_PLURAL = { corporations: "corporations", zones: "zones", circles: "circles", wards: "wards" };
const wardNo = (k) => String(Math.round(+k));
const bandIdxOf = (b) => (b === 5 ? 0 : b === 10 ? 1 : 2);

export function bandLegend() {
  const sw = (i) => `<span class="seg" style="display:inline-block;width:10px;height:10px;
      border-radius:3px;background:${BAND_COLORS[i][1]};margin:0 4px 0 ${i ? 8 : 0}px"></span>`;
  return `<p class="hint" style="margin:2px 0 8px">${sw(0)}under 5 min ${sw(1)}5–10
    ${sw(2)}10–15 ${sw(3)}over 15</p>`;
}

// deepest selected level → { level, key, unit }
export function currentScope(s) {
  if (SCOPE.ward && s.wards[SCOPE.ward])
    return { level: "wards", key: SCOPE.ward, unit: s.wards[SCOPE.ward] };
  if (SCOPE.circle && s.circles[SCOPE.circle])
    return { level: "circles", key: SCOPE.circle, unit: s.circles[SCOPE.circle] };
  if (SCOPE.zone && s.zones[SCOPE.zone])
    return { level: "zones", key: SCOPE.zone, unit: s.zones[SCOPE.zone] };
  if (SCOPE.corp && s.corporations[SCOPE.corp])
    return { level: "corporations", key: SCOPE.corp, unit: s.corporations[SCOPE.corp] };
  return { level: "extent", key: "", unit: s.extent };
}

// one level down from the current scope
// rank of the unit among all units of its level for the category's 15-min share
export function rankLine(s, level, key, cat) {
  if (level === "extent" || !s[level]) return "";
  const bi = bandIdxOf(ACCESS_BAND);
  const val = (u) => (u.cats?.[cat] || [0, 0, 0])[bi];
  const all = Object.entries(s[level]).filter(([, u]) => u.cats && !u.special);
  if (all.length < 2) return "";
  const mine = val(s[level][key]);
  const rank = 1 + all.filter(([k, u]) => k !== key && val(u) > mine).length;
  return `<p class="rank">Rank <b>${rank}</b> of ${all.length} ${LEVEL_PLURAL[level]} for ${CAT_PLURAL[cat]}</p>`;
}

// ---- scope: set by the breadcrumb (crumb.js); the card follows it ---------
export function setScope(sc) {
  SCOPE = { corp: sc.corp || "", zone: sc.zone || "", circle: "", ward: sc.ward || "" };
  if (window._view === "maps") renderAccessView();
}

// raw amenity counts for the unit (order = tier-1 map cats, then tier-2)
const COUNT_CATS = ["bus_stop", "metro", "mmts", "school", "anganwadi",
                    "park", "playground", "public_toilet", "healthcare",
                    "pharmacy", "grocery", "market", "community", "bank_atm",
                    "college"];

function countsBlock(counts) {
  if (!counts || !Object.keys(counts).length) return "";
  const rows = COUNT_CATS.filter((c) => counts[c]).map((c) =>
    `<tr><td><img class="ci" src="${iconDataURL(c)}" alt="">${CATEGORY_LABELS[c]}</td>
      <td class="v"><b>${counts[c].toLocaleString()}</b></td></tr>`).join("");
  return `<details class="group"><summary><span>Amenities in this area</span><span class="best">counts</span></summary>
    <table class="near">${rows}</table>
    <p class="hint" style="margin:6px 0 10px">Everything inside the boundary, at any distance.</p>
  </details>`;
}

// length-weighted street aggregate per admin unit (from summaries.json)
export function roadsBlock(r, open = true) {
  if (!r || !r.length_km) return "";
  const km = r.length_km >= 100 ? Math.round(r.length_km).toLocaleString()
    : r.length_km.toFixed(1);
  const hwy = Math.round(r.mix?.highway || 0), maj = Math.round(r.mix?.major || 0),
        con = Math.round(r.mix?.connector || 0), loc = Math.round(r.mix?.local || 0);
  const rows = [
    `<div class="qrow"><span>Street network</span><b>${km} km</b></div>`,
    r.pct_shaded != null &&
      `<div class="qrow"><span>Street shade (daytime average)</span>
        <b>${Math.round(r.pct_shaded)}% shaded</b></div>`,
    r.pct_canopy != null &&
      `<div class="qrow"><span>Tree-lined streets</span>
        <b>${Math.round(r.pct_canopy)}%</b></div>`,
    r.mean_slope != null &&
      `<div class="qrow"><span>Typical slope</span>
        <b>${r.mean_slope >= 5 ? "Steep" : r.mean_slope >= 3 ? "Noticeable" : "Gentle"}</b></div>`,
    (hwy + maj + con + loc) > 0 &&
      `<div class="qrow qblock"><span>Road types <span class="src">by length</span></span>
        <span class="minibar">
          <span class="seg" style="width:${hwy}%;background:#9B2226"></span>
          <span class="seg" style="width:${maj}%;background:#1B1913"></span>
          <span class="seg" style="width:${con}%;background:#7C7359"></span>
          <span class="seg" style="width:${loc}%;background:#C3BAA2"></span></span>
        <span class="roadmix-lg">
          ${hwy ? `<span><i style="background:#9B2226"></i>${hwy}% highway</span>` : ""}
          <span><i style="background:#1B1913"></i>${maj}% main road</span>
          <span><i style="background:#7C7359"></i>${con}% side road</span>
          <span><i style="background:#C3BAA2"></i>${loc}% lane</span></span></div>`,
    `<p class="hint caveat">Footpaths are not mapped yet. A ground survey and a data
      collection tool are coming soon.</p>`,
  ].filter(Boolean).join("");
  return `<details class="group" ${open ? "open" : ""}><summary><span>Streets</span><span class="best">shade · slope · types</span></summary>
    <div style="padding:2px 0 10px">${rows}</div></details>`;
}

// where the unit sits: "In Banjara Hills (Ward 45)" / "In the Khairatabad zone" …
export function placePhrase(level, key, unit, s) {
  if (level === "extent") return "Across HMDA";
  if (level === "wards") return `In ${unit.name} (Ward ${wardNo(key)})`;
  if (level === "circles") return `In ${unit.name ? unit.name + " circle" : "Circle " + key}`;
  if (level === "zones") return `In the ${key} zone`;
  return `In ${key}`;
}

// Wards card: lead sentence, rank, four headline bars, folds for the rest.
export function renderAccessView() {
  panelEmpty(false);
  getSummaries().then((s) => {
    if (!s) {
      body().innerHTML = `<div class="sec"><div class="sec-title">City</div>
        <p class="hint">Summaries unavailable.</p></div>`;
      return;
    }
    const { level, key, unit } = currentScope(s);
    const bi = bandIdxOf(ACCESS_BAND);
    const pct = (c) => Math.round((unit.cats?.[c] || [0, 0, 0])[bi]);
    // the category the visitor chose in "Show" (default: bus stops)
    const lay = window._activeLayer;
    const picked = CAT_FOR_LAYER[lay] || "bus_stop";
    // the sentence follows the layer: transport lists the three modes,
    // parks & playgrounds both, any other layer just its own category
    const leadCats = lay === "near_transit" ? ["bus_stop", "metro", "mmts"]
      : lay === "near_parks_play" ? ["park", "playground"] : [picked];
    // header: eyebrow = level, title = unit name, meta = parents
    const eyebrow = level === "extent" ? "All of Hyderabad"
      : level === "wards" ? `Ward ${wardNo(key)}` : level === "circles" ? "Circle"
      : level === "zones" ? "Zone" : "Corporation";
    const title = level === "extent" ? "Hyderabad (HMDA)"
      : level === "wards" ? unit.name : level === "circles" ? (unit.name || `Circle ${key}`) : key;
    const meta = [(level === "wards" || level === "circles") && unit.zone && `${unit.zone} zone`,
                  level !== "extent" && level !== "corporations" && unit.corporation]
      .filter(Boolean).join(" · ");
    const noun = (c) => CATEGORY_PHRASE[c] || CAT_PLURAL[c];
    const rest = leadCats.slice(1).map((c) => `<b>${pct(c)}%</b> of ${noun(c)}`);
    const tail = rest.length === 0 ? ""
      : rest.length === 1 ? `, and ${rest[0]}` : `, ${rest[0]} and ${rest[1]}`;
    const lead = `${placePhrase(level, key, unit, s)}, <b>${pct(leadCats[0])}%</b> of homes and
      buildings are within a ${ACCESS_BAND}-minute walk of ${noun(leadCats[0])}${tail}.`;
    // the corporation sits above the ward name and takes you back up a level
    const corpLink = level === "wards" && unit.corporation
      ? `<a href="#" class="crumb-up" data-corp="${unit.corporation}">${unit.corporation}</a>` : "";
    const instr = level === "extent" && matchMedia("(max-width: 768px)").matches
      ? `<p class="verdict m-instr"><b>Select an area</b> from search, or tap the map, to show its summary.</p>` : "";
    body().innerHTML = `${instr}
    <div class="card-head">
      <div class="card-head-txt">
        <span class="eyebrow">${corpLink || eyebrow}</span>
        <span class="card-title">${level === "wards" ? `${title} <span class="card-meta">· Ward ${wardNo(key)}</span>` : title}</span>
        ${level === "wards" && unit.zone ? `<span class="card-meta">${unit.zone} zone</span>` : meta ? `<span class="card-meta">${meta}</span>` : ""}
      </div>
    </div>
    <p class="verdict">${lead}</p>
    ${rankLine(s, level, key, picked)}
    <div class="sec">
      <div class="sec-title">Amenities</div>
      <div class="amhead"><span></span><span></span><span>count</span><span>walk time</span><span>15 min</span></div>
      ${amenityRows(unit.cats, unit.counts)}
      <p class="hint caveat" style="margin-top:8px">Share of the built-up area, so empty land
        does not count for or against an area. Counts are everything inside the boundary.</p>
      ${unit.excludes?.length ? `<p class="hint caveat">
        ${unit.excludes.join(" and ")} ${unit.excludes.length > 1 ? "lie" : "lies"} inside this
        ${(LEVEL_LABEL[level] || level).toLowerCase()} but ${unit.excludes.length > 1 ? "are" : "is"}
        mapped separately and not included here.</p>` : ""}
    </div>
    ${roadsBlock(unit.roads)}
    <div class="pin-actions" style="margin-top:14px">
      <button id="area-report" class="btn-secondary">Full report</button>
    </div>${DISCLAIMER_HTML}`;
    const rb = body().querySelector("#area-report");
    if (rb) rb.onclick = () => {
      const q = new URLSearchParams({ level, key, layer: window._activeLayer || "" });
      window.open(`report-area.html?${q}`, "_blank");
    };
    const up = body().querySelector(".crumb-up");
    if (up) up.onclick = (e) => { e.preventDefault();
      import("./crumb.js").then((c) => c.selectCorp(up.dataset.corp)); };
  });
}

// coverage layer dropdown re-renders the single page
window.addEventListener("walkatlas:coverlayer", () => {
  if (window._view === "maps") renderAccessView();
});

const fmtMin = (m) => (m == null ? null : m < 1 ? "under 1 min" : `${Math.round(m)} min`);
const inWords = (m) => (m == null ? null : m < 1 ? "under a minute"
  : Math.round(m) === 1 ? "1 minute" : `${Math.round(m)} minutes`);

// point summary (amenity icon / transit stop click) — name + facts in the panel
export function renderPointSummary({ eyebrow, title, rows = "", action = "" }) {
  panelEmpty(false);
  body().innerHTML = `
  <div class="sec">
    <div class="sec-title"><span>${eyebrow}</span>
      <a href="#" id="pt-close" class="pin-x" title="Close">✕</a></div>
    <div class="pt-name">${title}</div>
    ${rows}
    ${action}
  </div>`;
  const close = document.getElementById("pt-close");
  if (close) close.onclick = (e) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("walkatlas:unpin"));
  };
}

// the four headline rows of the pinned card, each = best of its group
const HEADLINE = [
  { label: "Public transport", cats: ["bus_stop", "metro", "mmts"], icon: "bus_stop",
    tag: { bus_stop: "bus stop", metro: "metro", mmts: "MMTS" } },
  { label: "School", cats: ["school"], icon: "school" },
  { label: "Park", cats: ["park", "playground"], icon: "park",
    tag: { park: "", playground: "playground" } },
  { label: "Public toilet", cats: ["public_toilet"], icon: "public_toilet" },
];
function headlineBest(near, band, noData = false) {
  return HEADLINE.map((h) => {
    let best = null;
    for (const c of h.cats) {
      const t = near[c];
      if (t != null && (!best || t < best.t)) best = { c, t };
    }
    return { ...h, best, noData };
  });
}

// two or three sentences from the numbers: what is close, what is missing
function verdict(rows, band) {
  const ok = rows.filter((r) => r.best).sort((a, b) => a.best.t - b.best.t);
  const missing = rows.filter((r) => !r.best);
  const phrase = (r) => CATEGORY_PHRASE[r.best.c] || r.label.toLowerCase();
  const out = [];
  if (ok.length >= 2)
    out.push(`From here you can reach ${phrase(ok[0])} in ${inWords(ok[0].best.t)} and
      ${phrase(ok[1])} in ${inWords(ok[1].best.t)}.`);
  else if (ok.length === 1)
    out.push(`From here you can reach ${phrase(ok[0])} in ${inWords(ok[0].best.t)}.`);
  else if (rows.every((r) => r.noData))
    out.push(`Amenity data is not available for this spot: it lies outside the analysed grid.`);
  else
    out.push(`No bus stop, school, park or public toilet is within a 15-minute walk of here.`);
  if (ok.length > 2) {
    const noun = (r) => (CATEGORY_PHRASE[r.best.c] || "").replace(/^an? /, "") || r.label.toLowerCase();
    out.push(`The nearest ${ok.slice(2).map((r) => `${noun(r)} is ${inWords(r.best.t)} away`)
      .join(", and the nearest ")}.`);
  }
  if (missing.length && ok.length)
    out.push(`No ${missing.map((r) => r.label.toLowerCase()).join(" or ")} within 15 minutes.`);
  return out.join(" ");
}

export function renderCellPanel(entry, band, place = null, coords = null, ward = null) {
  panelEmpty(false);
  const near = entry.near || {};
  const counts = entry.counts || {};
  const q = entry.q || {};
  const bandIdx = band === 5 ? 0 : band === 10 ? 1 : 2;

  // a shard entry with only "ws" is outside the analysed grid: no amenity data at all
  const rows = headlineBest(near, band, !entry.near && !entry.counts);
  const nearRows = rows.map((r) => {
    const b = r.best;
    const n = r.cats.reduce((s, c) => s + ((counts[c] || [0, 0, 0])[bandIdx] || 0), 0);
    const tag = b && r.tag && r.tag[b.c] ? `<span class="tag">· ${r.tag[b.c]}</span>` : "";
    const v = b ? `${fmtMin(b.t)} ${tag}` : `<span class="far">over 15 min</span>`;
    const cnt = n > 0 ? `<span class="cnt">${n} within ${band} min</span>` : "";
    return `<tr><td><img class="ci" src="${iconDataURL(r.icon)}" alt="">${r.label}</td>
      <td class="v">${v}${cnt ? `<br>${cnt}` : ""}</td></tr>`;
  }).join("");

  // what else is nearby: counts + a checkbox to plot that one category on the
  // map, confined to the selected walkshed (one at a time).
  const t2 = TIER2.map((c) => {
    const n = (counts[c] || [0, 0, 0])[bandIdx];
    const v = n > 0
      ? `<b>${n}</b> <span class="cnt">within ${band} min</span>`
      : `<span class="far">none within ${band} min</span>`;
    const lab = `<label class="t2-toggle ${n > 0 ? "" : "off"}">
        <input type="checkbox" class="t2-show" data-cat="${c}"
          ${n > 0 ? "" : "disabled"} ${window._amenityExtra === c ? "checked" : ""}>
        <img class="ci" src="${iconDataURL(c)}" alt="">${CATEGORY_LABELS[c]}</label>`;
    return `<tr><td>${lab}</td><td class="v">${v}</td></tr>`;
  }).join("");
  const tier2Rows = `<details class="group" ${window._amenityExtra ? "open" : ""}><summary>
      <span>What else is nearby</span><span class="best">tick to show</span></summary>
    <table class="near">${t2}</table></details>`;

  const shadePct = q.shade != null ? Math.round(q.shade * 100) : null;
  const treePct = q.tree != null ? Math.round(q.tree * 100) : null;
  const slopeWord = q.slope == null ? null : q.slope >= 5 ? "Steep" : q.slope >= 3 ? "Noticeable" : "Gentle";
  const tiles = `<div class="tiles">
    <div class="tile"><span class="tv">${shadePct != null ? shadePct + "%" : "–"}</span><span class="tk">shaded</span></div>
    <div class="tile"><span class="tv">${treePct != null ? treePct + "%" : "–"}</span><span class="tk">tree-lined</span></div>
    <div class="tile"><span class="tv">${slopeWord ?? "–"}</span><span class="tk">slope</span></div>
  </div>`;
  const shadeNote = !entry.q
    ? `<p class="hint caveat">No street data for this spot: it lies outside the analysed grid.</p>`
    : shadePct == null
    ? `<p class="hint caveat">No shade or tree data here. It is mapped for the four core
        corporations only.</p>`
    : `<p class="hint caveat">Share of the streets within reach that are shaded by buildings and
        trees, averaged over daylight hours on four days spread across the year.</p>`;
  const footNote = `<p class="hint caveat">Footpaths are not mapped yet. A ground survey and a
      data collection tool are coming soon.</p>`;

  // toilets + tier-2 overlay pins carry no standalone report → hide the button
  const reportBtn = `<button id="pin-report" class="btn-secondary">Full report</button>`;
  const wardLine = ward ? `Ward ${ward.ward_no} · ${ward.ward}${ward.zone ? ` · ${ward.zone} zone` : ""}` : "";
  const title = place ? place.name : (ward?.ward || "Pinned spot");
  const meta = place ? wardLine : (ward ? `Ward ${ward.ward_no}${ward.zone ? ` · ${ward.zone} zone` : ""}` : "");
  // a place pin: its icon beside the name; a stop also gets its service line
  // and the way into Bus & Metro
  const eyebrow = place ? (place.kind || place.category) : "Pinned spot";
  const icon = place?.cat ? `<img class="ci ci-head" src="${iconDataURL(place.cat)}" alt="">` : "";
  // service line, with the way into Bus & Metro on the same line
  // the way into Bus & Metro sits on the eyebrow line: BUS STOP | Routes from here
  const routesLink = place?.transit
    ? `<span class="eyebrow-sep">|</span><a href="#" id="pt-transit" class="routes-link">Routes from here →</a>` : "";
  const svc = place?.service ? `<span class="card-meta">${place.service}</span>` : "";
  const routesBtn = "";
  const header = `
  <div class="card-head">
    <div class="card-head-txt">
      <span class="eyebrow">${eyebrow}${routesLink}</span>
      <span class="card-title">${icon}${title}</span>
      ${svc}
      ${meta ? `<span class="card-meta">${meta}</span>` : ""}
    </div>
    <a href="#" id="unpin" class="pin-x" title="Clear" aria-label="Clear pin">✕</a>
  </div>
  ${routesBtn}`;

  body().innerHTML = `
  ${header}
  <p class="verdict">${verdict(rows, band)}</p>
  <div class="sec">
    <div class="sec-title">The walk itself</div>
    ${tiles}
    ${shadeNote}
    ${footNote}
  </div>
  <div class="sec">
    <div class="sec-title">Walk to nearest</div>
    <table class="near">${nearRows}</table>
    <p class="hint caveat" style="margin-top:6px">Along streets. Bus stops with almost
      no service are not counted.</p>
  </div>
  <div class="sec">
    ${tier2Rows}
  </div>
  <div class="card-acts">
    ${reportBtn}
    <button id="pin-copy" class="btn-secondary">Copy link</button>
  </div>${DISCLAIMER_HTML}`;
  document.getElementById("unpin").onclick = (e) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("walkatlas:unpin"));
  };
  const rb = document.getElementById("pin-report");
  if (rb) rb.onclick = () =>
    window.dispatchEvent(new CustomEvent("walkatlas:report", { detail: { place, ward } }));
  document.getElementById("pin-copy").onclick = () =>
    document.getElementById("btn-share")?.click();               // same copy-link path as Share

  // "What else is nearby" checkboxes → plot one category inside the walkshed
  document.querySelectorAll(".t2-show").forEach((ck) => {
    ck.onchange = () => {
      if (ck.checked)   // single-select: clear the others
        document.querySelectorAll(".t2-show").forEach((o) => { if (o !== ck) o.checked = false; });
      window.dispatchEvent(new CustomEvent("walkatlas:extraamenity",
        { detail: ck.checked ? ck.dataset.cat : null }));
    };
  });
  const t = document.getElementById("pt-transit");
  if (t) t.onclick = (e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent(
    "walkatlas:opentransitstop", { detail: place.transit })); };
}
