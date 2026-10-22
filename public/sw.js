const CACHE_NAME = "dirty-turf-shell-v2";
const MANIFEST_URL = "/vite-manifest.json";
const APP_SHELL = [
  "/",
  MANIFEST_URL,
  "/manifest.webmanifest",
  "/terms.html",
  "/privacy.html",
  "/support.html",
  "/delete-account.html",
  "/legal.css",
  "/dirty-turf-logo.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(precacheProductionAssets().then(() => self.skipWaiting()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "PRECACHE_APP") event.waitUntil(precacheProductionAssets());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("dirty-turf-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match(request, { ignoreSearch: true })) ?? caches.match("/")));
    return;
  }

  // Cache the public app shell and build assets only. Same-origin API responses
  // can contain account data and must never enter a shared offline cache.
  if (!url.pathname.startsWith("/assets/") && !APP_SHELL.includes(url.pathname) && !url.pathname.startsWith("/email-assets/")) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then((response) => {
        if (response.ok && expectedAssetType(url.pathname, response)) {
          const copy = response.clone();
          // Cache quota failures must not turn a successful network read into
          // an unhandled worker rejection or prevent this response rendering.
          return caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).then(() => response, () => response);
        }
        return response;
      });
    if (!cached) return network;
    event.waitUntil(network.catch(() => undefined));
    return cached;
  })());
});

let precachePromise;
function expectedAssetType(asset, response) {
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (asset.endsWith(".js")) return ["application/javascript", "text/javascript", "application/x-javascript", "application/ecmascript", "text/ecmascript"].includes(contentType);
  if (asset.endsWith(".css")) return contentType === "text/css";
  return true;
}

function precacheProductionAssets() {
  if (!precachePromise) precachePromise = cacheCompleteRelease().finally(() => { precachePromise = undefined; });
  return precachePromise;
}

async function cacheCompleteRelease() {
  const manifestResponse = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("Vite asset manifest could not be loaded");
  const manifest = await manifestResponse.clone().json();
  if (!manifest || typeof manifest !== "object" || typeof manifest["index.html"]?.file !== "string") throw new Error("Vite asset manifest is incomplete");
  const assets = new Set(APP_SHELL);
  for (const entry of Object.values(manifest)) {
    for (const file of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
      if (file) {
        if (typeof file !== "string" || /[\\?#:]/.test(file) || file.startsWith("/") || file.split("/").some((part) => part === "..")) throw new Error("Vite asset path is unsafe");
        assets.add(`/${file}`);
      }
    }
  }

  // Stage all responses before changing the saved startup document. A failed
  // chunk, CDN HTML fallback or half-complete deploy keeps the old shell usable.
  const responses = new Map([[MANIFEST_URL, manifestResponse]]);
  await Promise.all([...assets].filter((asset) => asset !== MANIFEST_URL).map(async (asset) => {
    const response = await fetch(asset, { cache: "no-store" });
    if (!response.ok) throw new Error(`Asset could not be cached: ${asset}`);
    if (!expectedAssetType(asset, response)) throw new Error(`Asset has the wrong content type: ${asset}`);
    responses.set(asset, response);
  }));
  const startup = responses.get("/");
  if (!startup || !(await startup.clone().text()).includes(`/${manifest["index.html"].file}`)) throw new Error("App HTML and asset manifest are from different releases");
  const cache = await caches.open(CACHE_NAME);
  await Promise.all([...responses].filter(([asset]) => asset !== "/").map(([asset, response]) => cache.put(asset, response)));
  // Commit last: storage errors above leave the prior complete startup HTML.
  await cache.put("/", startup);
}
