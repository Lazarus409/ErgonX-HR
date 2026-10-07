/*
 * Deliberately conservative PWA worker.
 *
 * ErgonX is an authenticated, tenant-scoped ERP. This worker never caches
 * navigation responses or `/api/` requests, which prevents credentials and
 * institution data from being replayed across sessions. It only stores static
 * same-origin assets and the generic offline fallback.
 */
const CACHE_NAME = "ergonx-static-v2";
const OFFLINE_URL = "/offline";
const PRE_CACHE = [OFFLINE_URL, "/manifest.webmanifest", "/brand/ergonx-mark.png", "/brand/ergonx-logo-primary.png", "/brand/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRE_CACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL)),
    );
    return;
  }

  const staticDestination = ["style", "script", "font", "image"].includes(request.destination);
  if (!staticDestination) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (!response.ok || response.type !== "basic") return response;
      const responseCopy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => cache.put(request, responseCopy));
      return response;
    })),
  );
});
