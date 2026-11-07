// Shard loading + caching: cells (walksheds/panel data) and stops.
import { DATA_URL, H3_RES } from "../config.js";
import { endpoints } from "./map.js";
import { latLngToCell, cellToParent } from "../vendor/h3-js.js";

const cellCache = new Map();   // parent -> data | Promise
const stopCache = new Map();

const shardBytes = new Map();   // parent -> content-length (for honest progress)
async function loadShard(cache, tmpl, parent) {
  if (cache.has(parent)) return cache.get(parent);
  const p = fetch(`${DATA_URL}/${tmpl.replace("{parent}", parent)}`,
    { cache: "no-cache" })
    .then((r) => { shardBytes.set(parent, +r.headers.get("content-length") || 0);
                   return r.ok ? r.json() : {}; })
    .then((d) => { cache.set(parent, d); return d; })
    .catch(() => ({}));
  cache.set(parent, p);
  return p;
}

/** Preload the cell shards around a point (the parent shard + its neighbours,
 *  found by sampling ~1.6 km around). onProgress(done, total, bytes) fires as
 *  each shard lands. Used by the mobile start sheet. */
export async function preloadAround(lng, lat, onProgress) {
  const d = 0.015;
  const parents = new Set();
  for (const [dx, dy] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, d], [d, -d], [-d, -d]])
    parents.add(latLngToCell(lat + dy, lng + dx, endpoints.shards.shardRes));
  const list = [...parents];
  let done = 0;
  await Promise.all(list.map((parent) =>
    loadShard(cellCache, endpoints.shards.cells, parent).then(() => {
      done += 1;
      if (onProgress) onProgress(done, list.length, shardBytes.get(parent) || 0);
    })));
}

export function cellForLngLat(lng, lat) {
  return latLngToCell(lat, lng, H3_RES);
}

export async function getCellEntry(cell) {
  const parent = cellToParent(cell, endpoints.shards.shardRes);
  const shard = await loadShard(cellCache, endpoints.shards.cells, parent);
  return shard[cell] || null;
}

/** Synchronous lookup for hover (no await mid-mousemove). */
export function getCellEntrySync(cell) {
  const parent = cellToParent(cell, endpoints.shards.shardRes);
  const shard = cellCache.get(parent);
  if (shard && typeof shard.then !== "function") return shard[cell] || null;
  loadShard(cellCache, endpoints.shards.cells, parent);   // warm it
  return undefined;   // loading
}

export async function getStopEntry(stopId, lng, lat) {
  const parent = latLngToCell(lat, lng, endpoints.shards.shardRes);
  const shard = await loadShard(stopCache, endpoints.shards.stops, parent);
  return shard[stopId] || null;
}

/** Prefetch shards covering the viewport (call on moveend). */
export function prefetchViewport(map) {
  const b = map.getBounds();
  for (const [lng, lat] of [
    [b.getWest(), b.getSouth()], [b.getWest(), b.getNorth()],
    [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()],
    [(b.getWest() + b.getEast()) / 2, (b.getSouth() + b.getNorth()) / 2]]) {
    const parent = latLngToCell(lat, lng, endpoints.shards.shardRes);
    loadShard(cellCache, endpoints.shards.cells, parent);
  }
}
