// Landing card — shown on every load that has no link in the URL, on phones
// (bottom sheet) and desktops (centred card). Explains the 5 / 10 / 15 minute
// rings, then three ways in: "Explore the map" (dismiss; the map opens on a
// random spot), "Near me" (geolocation → load the data around the visitor,
// then pin there), "Search a place". Loading shows REAL progress.
import { MAX_BOUNDS, START_ZOOM_MOBILE } from "../config.js";
import { preloadAround } from "./shards.js";

const SEEN_KEY = "aa:start-seen";

export function initStart(map, mq) {
  const sheet = document.getElementById("start-sheet");
  if (!sheet) return;
  const skip = location.hash.length > 1;   // main.js has already dropped bare view hashes
  if (skip) { sheet.hidden = true; return; }
  sheet.hidden = false;

  const choices = sheet.querySelector(".start-actions");
  const loading = sheet.querySelector(".start-loading");
  const bar = sheet.querySelector(".start-bar > span");
  const pctEl = sheet.querySelector(".start-pct");
  const stepEl = sheet.querySelector(".start-step");
  const noteEl = sheet.querySelector(".start-note");

  const dismiss = () => {
    sheet.hidden = true;
    try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode */ }
  };
  const openSearch = (note) => {
    dismiss();
    const box = document.getElementById("search-box");
    const input = document.getElementById("search-input");
    // defer past the document-level click handler that closes the search box
    setTimeout(() => {
      if (box) box.classList.add("open");
      if (input) { if (note) input.placeholder = note; input.focus(); }
    }, 0);
  };
  const progress = (pct, step) => {
    bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    pctEl.textContent = `${Math.round(pct)}%`;
    if (step) stepEl.textContent = step;
  };
  const inBounds = (lng, lat) =>
    lng >= MAX_BOUNDS[0][0] && lng <= MAX_BOUNDS[1][0] &&
    lat >= MAX_BOUNDS[0][1] && lat <= MAX_BOUNDS[1][1];

  let cancelled = false;
  async function loadAround(lng, lat) {
    choices.hidden = true; loading.hidden = false;
    sheet.querySelector(".start-graphic").hidden = true;
    progress(4, "Locating you");
    map.jumpTo({ center: [lng, lat], zoom: START_ZOOM_MOBILE });
    // 1) walkshed shards around the point (≈70% of the bar, counted honestly)
    let bytes = 0;
    await preloadAround(lng, lat, (done, total, size) => {
      bytes += size || 0;
      progress(4 + (done / total) * 70, `Walking ranges · ${done} of ${total} areas`);
    });
    if (cancelled) return;
    // 2) basemap + data tiles for the first view (map goes idle)
    progress(78, "Map tiles");
    await new Promise((resolve) => {
      let finished = false;
      const finish = () => { if (!finished) { finished = true; resolve(); } };
      if (map.loaded()) finish();
      else { map.once("idle", finish); setTimeout(finish, 8000); }   // never hang on a slow tile
    });
    if (cancelled) return;
    progress(100, "Ready");
    noteEl.textContent = bytes ? `${(bytes / 1048576).toFixed(1)} MB loaded · cached for next time`
      : "Cached for next time";
    setTimeout(() => {
      dismiss();
      window.dispatchEvent(new CustomEvent("walkatlas:pinat", { detail: { lng, lat } }));
    }, 350);
  }

  const nearBtn = sheet.querySelector("[data-start=near]");
  if (nearBtn) nearBtn.onclick = () => {
    if (!navigator.geolocation) { openSearch("Location unavailable. Search a place"); return; }
    choices.hidden = true; loading.hidden = false; progress(2, "Asking for your location");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude: lng, latitude: lat } = pos.coords;
        if (!inBounds(lng, lat)) { openSearch("You're outside Telangana. Search a place"); return; }
        loadAround(lng, lat);
      },
      () => openSearch("Location not shared. Search a place"),   // refused / failed → search
      { timeout: 8000, maximumAge: 60000 });
  };
  const searchBtn = sheet.querySelector("[data-start=search]");
  if (searchBtn) searchBtn.onclick = () => openSearch();
  sheet.querySelector("[data-start=browse]").onclick = dismiss;
  sheet.querySelector("[data-start=cancel]").onclick = () => { cancelled = true; dismiss(); };
  const aboutLink = sheet.querySelector("[data-start=about]");
  if (aboutLink) aboutLink.onclick = (e) => {
    e.preventDefault(); dismiss(); document.getElementById("about-page").hidden = false;
  };
}
