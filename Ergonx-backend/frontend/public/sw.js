const CACHE = "ergonx-static-v1";
const SHELL = ["/", "/offline", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isStatic = url.origin === self.location.origin && (url.pathname.startsWith("/_next/") || url.pathname === "/icon.svg");
  if (isStatic) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response;
    })));
    return;
  }
  if (event.request.mode === "navigate") event.respondWith(fetch(event.request).catch(() => caches.match("/offline")));
});
