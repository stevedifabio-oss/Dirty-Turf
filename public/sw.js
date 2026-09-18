const CACHE_NAME = "dirty-turf-shell-v2";
const MANIFEST_URL = "/vite-manifest.json";
const APP_SHELL = [
  "/",
  MANIFEST_URL,
  "/manifest.webmanifest",
  "/dirty-turf-logo.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(precacheProductionAssets());
  self.skipWaiting();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "PRECACHE_APP") event.waitUntil(precacheProductionAssets());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    if (!cached) return network;
    event.waitUntil(network.catch(() => undefined));
    return cached;
  })());
});

async function precacheProductionAssets() {
  const manifestResponse = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("Vite asset manifest could not be loaded");
  const manifest = await manifestResponse.json();
  const assets = new Set(APP_SHELL);
  for (const entry of Object.values(manifest)) {
    for (const file of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
      if (file) assets.add(`/${file.replace(/^\//, "")}`);
    }
  }

  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled([...assets].map(async (asset) => {
    const response = await fetch(asset, { cache: "no-store" });
    if (!response.ok) throw new Error(`Asset could not be cached: ${asset}`);
    await cache.put(asset, response);
  }));
  if (results.every((result) => result.status === "rejected")) {
    throw new Error("No production assets could be cached");
  }
}
