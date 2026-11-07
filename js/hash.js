// URL hash state — shared by main.js (moveend, Share) and walkshed.js (pin).
// #<tab>/z/lat/lng[/extra]: tab is street | city | transit; extra is the pinned
// cell on Street, the Show layer on City. Links from before the tab was written
// start with the zoom (#z/lat/lng/layer/cell) and still open.
const TAB = { explore: "street", maps: "city", transit: "transit" };
const VIEW = { street: "explore", city: "maps", transit: "transit" };

export function writeHash(map, layer, cell) {
  const v = window._view || "explore";
  const c = map.getCenter();
  const parts = [TAB[v], map.getZoom().toFixed(2), c.lat.toFixed(5), c.lng.toFixed(5)];
  const extra = v === "explore" ? cell : v === "maps" ? layer : null;
  if (extra) parts.push(extra);
  history.replaceState(null, "", "#" + parts.join("/"));
}

export function parseHash() {
  const p = location.hash.slice(1).split("/");
  if (VIEW[p[0]] && p.length >= 4 && !isNaN(+p[1])) {
    const view = VIEW[p[0]];
    return { view, zoom: +p[1], center: [+p[3], +p[2]],
             layer: view === "maps" ? p[4] || null : null,
             cell: view === "explore" ? p[4] || null : null };
  }
  if (p.length >= 3 && !isNaN(+p[0])) {          // old link: no tab
    return { zoom: +p[0], center: [+p[2], +p[1]], legacy: true,
             layer: p[3] || null, cell: p[4] || null, view: p[3] ? "maps" : "explore" };
  }
  return {};
}
