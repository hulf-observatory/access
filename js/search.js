// Place search — OSM Nominatim, bounded to the current map extent's city.
// External service, called only on user keystrokes (debounced); results
// are plain flyTo targets. Degrades silently offline.
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const BOUNDS = "78.2,17.2,78.7,17.6";   // Hyderabad viewbox (W,S,E,N)

export async function searchPlaces(q) {
  try {
    const url = `${NOMINATIM}?format=json&limit=6&viewbox=${BOUNDS}&bounded=1&q=${encodeURIComponent(q)}`;
    return await (await fetch(url)).json();
  } catch { return []; }
}

export function initSearch(map) {
  const box = document.getElementById("search-box");
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  let timer = null;
  // results open upward into the legend's space: tuck the legend while they show
  const legend = document.getElementById("legend");
  new MutationObserver(() => legend?.classList.toggle("tucked", !results.classList.contains("hidden")))
    .observe(results, { attributes: true, attributeFilter: ["class"] });

  // collapsed icon on the map — expands on click (hover handled in CSS)
  document.getElementById("search-toggle").onclick = () => {
    box.classList.toggle("open");
    if (box.classList.contains("open")) input.focus();
    else results.classList.add("hidden");
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { results.classList.add("hidden"); return; }
    timer = setTimeout(async () => {
      try {
        const url = `${NOMINATIM}?format=json&limit=6&viewbox=${BOUNDS}` +
          `&bounded=1&q=${encodeURIComponent(q)}`;
        const hits = await (await fetch(url)).json();
        results.innerHTML = "";
        for (const h of hits) {
          const div = document.createElement("div");
          div.textContent = h.display_name.split(",").slice(0, 3).join(", ");
          div.onclick = () => {
            map.flyTo({ center: [+h.lon, +h.lat], zoom: 15.5 });
            results.classList.add("hidden");
            input.value = div.textContent;
          };
          results.appendChild(div);
        }
        results.classList.toggle("hidden", !hits.length);
      } catch { results.classList.add("hidden"); }
    }, 450);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#search-box")) {
      results.classList.add("hidden");
      box.classList.remove("open");
    }
  });
}
