// Phone layout (max-width 768px): the map with one sheet under it.
// Everything that floats on desktop (legend, breadcrumb, search, the street and
// layer controls) either lives in the sheet's top row or is a pill on the map.
// Nothing in here runs on desktop: initMobile() returns at once when the media
// query does not match, and every DOM hook it uses is hidden by CSS above 768px.
import { getSummaries } from "./panel.js";
import { selectCity, selectCorp, selectWard } from "./crumb.js";
import { searchPlaces } from "./search.js";
import { DETAIL_ZOOM } from "./map.js";

const $ = (s) => document.querySelector(s);
const wardNo = (k) => String(Math.round(+k));
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function initMobile(map, mq) {
  if (!mq.matches) return;
  const panel = $("#panel"), body = $("#panel-body"), grip = $("#sheet-grip"), app = $("#app");
  const header = $("#topbar");

  // ---- sheet: three resting heights; the card scrolls only at full ------------
  const SNAPS = {
    peek: () => 150,
    half: () => Math.round(app.clientHeight * 0.5),
    full: () => app.clientHeight,
  };
  let snap = "peek";
  function setSnap(s) {
    snap = s;
    panel.classList.remove("collapsed", "expanded");
    if (s === "peek") panel.classList.add("collapsed");
    if (s === "full") panel.classList.add("expanded");
    panel.style.height = SNAPS[s]() + "px";
    panel.classList.add("anim");
    positionPills();
    setTimeout(() => { if (map.getSource("walkshed")) map.resize(); }, 300);
  }
  function positionPills() {
    const b = SNAPS[snap]() + 10;
    for (const id of ["m-legend-pill", "m-pin"]) { const el = document.getElementById(id); if (el) el.style.bottom = b + "px"; }
  }
  let drag = null;
  const startDrag = (y) => { drag = { y, h: panel.offsetHeight }; panel.classList.remove("anim"); };
  const moveDrag = (y) => {
    if (!drag) return;
    const h = Math.max(SNAPS.peek(), Math.min(SNAPS.full(), drag.h - (y - drag.y)));
    panel.style.height = h + "px";
  };
  const endDrag = () => {
    if (!drag) return;
    const h = panel.offsetHeight; drag = null;
    const best = Object.entries(SNAPS).map(([k, f]) => [k, Math.abs(f() - h)]).sort((a, b) => a[1] - b[1])[0][0];
    setSnap(best);
  };
  grip.addEventListener("pointerdown", (e) => { startDrag(e.clientY); grip.setPointerCapture(e.pointerId); });
  grip.addEventListener("pointermove", (e) => moveDrag(e.clientY));
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);
  // dragging the card itself moves the sheet until it is at full; at full and
  // scrolled to the top, a drag down brings it back to half
  let bd = null;
  body.addEventListener("pointerdown", (e) => { bd = { y: e.clientY, top: body.scrollTop, id: e.pointerId }; });
  body.addEventListener("pointermove", (e) => {
    if (!bd) return;
    const dy = e.clientY - bd.y;
    if (Math.abs(dy) < 8) return;
    if (snap === "full" && !(bd.top === 0 && dy > 0)) return;
    if (!drag) { startDrag(bd.y); try { body.setPointerCapture(bd.id); } catch { /* fine */ } }
    moveDrag(e.clientY);
  });
  body.addEventListener("pointerup", () => { bd = null; endDrag(); });
  body.addEventListener("pointercancel", () => { bd = null; endDrag(); });
  grip.addEventListener("click", () => setSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "peek"));
  window.addEventListener("walkatlas:opensheet", () => { if (snap === "peek") setSnap("half"); });
  window.addEventListener("walkatlas:unpin", () => { if (window._view === "explore") setSnap("peek"); });
  window.addEventListener("walkatlas:viewchange", (e) => setSnap(e.detail === "maps" ? "half" : "peek"));
  new ResizeObserver(() => { panel.classList.remove("anim"); panel.style.height = SNAPS[snap]() + "px"; positionPills(); }).observe(app);
  setSnap("peek");

  // ---- header menu: About and Share ------------------------------------------
  const menu = $("#m-menu"), menuBtn = $("#btn-menu");
  menuBtn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener("click", () => { menu.hidden = true; });
  $("#m-about").onclick = () => { menu.hidden = true; $("#btn-about").click(); };
  $("#m-share").onclick = async () => {
    menu.hidden = true;
    if (navigator.share) {
      $("#btn-share").click();   // writes the hash first
      try { await navigator.share({ title: document.title, url: location.href }); } catch { /* cancelled */ }
    } else $("#btn-share").click();
  };

  // ---- pin: the crosshair is the measuring point until something is pinned ------
  const cross = $("#m-crosshair"), pinBtn = $("#m-pin");
  const syncCross = () => {
    const walk = window._view === "explore";
    const detail = map.getZoom() >= DETAIL_ZOOM;
    cross.hidden = !(walk && detail && !window._pinnedCell);
    pinBtn.hidden = !(walk && !window._pinnedCell);
  };
  pinBtn.onclick = () => {
    const c = map.getCenter();
    if (map.getZoom() < DETAIL_ZOOM) {
      map.once("moveend", () => window.dispatchEvent(new CustomEvent("walkatlas:pinat", { detail: { lng: c.lng, lat: c.lat } })));
      map.easeTo({ zoom: 14.5, duration: 600 });
      return;
    }
    window.dispatchEvent(new CustomEvent("walkatlas:pinat", { detail: { lng: c.lng, lat: c.lat } }));
  };
  map.on("zoom", syncCross);
  for (const ev of ["walkatlas:viewchange", "walkatlas:unpin", "walkatlas:opensheet", "walkatlas:pinat"])
    window.addEventListener(ev, () => setTimeout(syncCross, 0));
  new MutationObserver(syncCross).observe(body, { childList: true });
  syncCross();

  // ---- search button sits under the map's own controls, whatever their height --
  const searchBtn = $("#m-search");
  const placeSearch = () => {
    const ctrl = $("#map-wrap .maplibregl-ctrl-top-right");
    if (!ctrl) return;
    const r = ctrl.getBoundingClientRect(), w = $("#map-wrap").getBoundingClientRect();
    searchBtn.style.top = Math.round(r.bottom - w.top + 8) + "px";
  };
  placeSearch();
  map.on("load", placeSearch);
  new ResizeObserver(placeSearch).observe($("#map-wrap"));
  setTimeout(placeSearch, 800);

  // ---- a pin or a stop: fit its walk range into the map above the sheet ---------
  const fitRange = () => {
    const fc = map.getSource("walkshed-pin")?._data;
    if (!fc?.features?.length) return;
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    const scan = (c) => Array.isArray(c[0]) ? c.forEach(scan)
      : (x0 = Math.min(x0, c[0]), y0 = Math.min(y0, c[1]), x1 = Math.max(x1, c[0]), y1 = Math.max(y1, c[1]));
    fc.features.forEach((f) => scan(f.geometry.coordinates));
    if (x0 > x1) return;
    map.fitBounds([[x0, y0], [x1, y1]], { padding: { top: 70, bottom: SNAPS.half() + 30, left: 30, right: 60 }, maxZoom: 15.5, duration: 600 });
  };
  // the range arrives once its shard has loaded: try soon, then once more
  window.addEventListener("walkatlas:opensheet", () => { setTimeout(fitRange, 450); setTimeout(fitRange, 1400); });

  // ---- legend: a pill that opens the desktop legend's content as a card -------
  const legendCard = $("#m-legend-card"), legendBody = $("#legend-body"), legendHome = $("#legend");
  $("#m-legend-pill").onclick = () => {
    legendCard.querySelector(".m-card-body").appendChild(legendBody);   // the real node, styles and all
    legendCard.hidden = false;
  };
  legendCard.addEventListener("click", (e) => {
    if (e.target === legendCard || e.target.closest("[data-close]")) { legendCard.hidden = true; legendHome.appendChild(legendBody); }
  });

  // ---- one picker: type to search, or browse Hyderabad › corporation › ward ----
  const picker = $("#m-picker"), input = picker.querySelector("input"), list = picker.querySelector(".m-plist");
  let S = null, corp = null, timer = null;
  const open = () => { picker.hidden = false; input.value = ""; corp = null; render(); setTimeout(() => input.focus(), 50); };
  const close = () => { picker.hidden = true; input.blur(); };
  $("#m-search").onclick = open;
  picker.querySelector("[data-close]").onclick = close;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  // an area pick: City selects it; Street and Transit only move there
  const goArea = (fn) => { close(); fn(); };
  const corps = () => Object.keys(S.corporations).filter(Boolean).sort();
  const wards = (c) => Object.entries(S.wards).filter(([, w]) => w.name && w.corporation === c)
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  const shortCorp = (c) => c.replace(" Municipal Corporation", "").replace(" Corporation", "").replace("Greater Hyderabad", "GHMC");
  function rowHTML(kind, v, label, sub) {
    return `<button type="button" data-${kind}="${esc(v)}">${esc(label)}${sub ? ` <small>${esc(sub)}</small>` : ""}</button>`;
  }
  async function render() {
    if (!S) S = await getSummaries();
    if (!S) { list.innerHTML = `<p class="hint" style="padding:12px">Area list unavailable.</p>`; return; }
    const q = input.value.trim().toLowerCase();
    let html = "";
    if (q) {
      const cs = corps().filter((c) => c.toLowerCase().includes(q));
      const ws = Object.entries(S.wards).filter(([k, w]) => w.name && (w.name.toLowerCase().includes(q) || wardNo(k) === q));
      html += `<div class="m-lh">Places</div><div class="m-places"><p class="hint" style="padding:8px 10px">Searching…</p></div>`;
      if (cs.length) html += `<div class="m-lh">Corporations</div>` + cs.map((c) => rowHTML("corp", c, c)).join("");
      if (ws.length) html += `<div class="m-lh">Wards</div>` + ws.slice(0, 40).map(([k, w]) => rowHTML("ward", k, w.name, `Ward ${wardNo(k)} · ${w.zone || ""} zone`)).join("");
    } else if (!corp) {
      html = `<div class="m-lh">Browse</div>${rowHTML("city", "1", "All of Hyderabad", "HMDA")}<div class="m-lh">Corporations</div>`
        + corps().map((c) => rowHTML("cb", c, c, "›")).join("");
    } else {
      const ws = wards(corp);
      html = rowHTML("back", "1", "‹ Hyderabad") + `<div class="m-lh">${esc(shortCorp(corp))}</div>${rowHTML("corp", corp, `All of ${shortCorp(corp)}`)}`
        + (ws.length ? `<div class="m-lh">Wards</div>` + ws.map(([k, w]) => rowHTML("ward", k, w.name, `Ward ${wardNo(k)} · ${w.zone || ""} zone`)).join("")
                     : `<p class="hint" style="padding:10px">Mapped as one area, no wards.</p>`);
    }
    list.innerHTML = html;
    list.querySelectorAll("button").forEach((b) => b.onclick = () => {
      const d = b.dataset;
      if (d.cb) { corp = d.cb; render(); return; }
      if (d.back) { corp = null; render(); return; }
      if (d.city) goArea(selectCity);
      else if (d.corp) goArea(() => selectCorp(d.corp));
      else if (d.ward) goArea(() => selectWard(d.ward));
      else if (d.place) { close(); map.flyTo({ center: JSON.parse(d.place), zoom: 15.5 }); }
    });
    if (q) {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const hits = await searchPlaces(q);
        const box = list.querySelector(".m-places");
        if (!box) return;
        box.innerHTML = hits.length ? hits.map((h) => rowHTML("place", JSON.stringify([+h.lon, +h.lat]), h.display_name.split(",")[0], h.display_name.split(",").slice(1, 3).join(","))).join("")
          : `<p class="hint" style="padding:8px 10px">No place found. Try a locality or landmark.</p>`;
        box.querySelectorAll("[data-place]").forEach((b) => b.onclick = () => { close(); map.flyTo({ center: JSON.parse(b.dataset.place), zoom: 15.5 }); });
      }, 350);
    }
  }
  input.addEventListener("input", render);
}
