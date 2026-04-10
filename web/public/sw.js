/// <reference lib="webworker" />

const CACHE_VERSION = "v2";
const STATIC_CACHE = `pfxt-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `pfxt-dynamic-${CACHE_VERSION}`;
const FALLBACK_URL = "/offline.html";

// Assets to precache on install
const PRECACHE_ASSETS = [
  "/",
  "/manifest.json",
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch(() => {
        // Don't fail install if precache fails
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activate ────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("pfxt-") && k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and WebSocket
  if (event.request.method !== "GET") return;
  if (url.protocol === "ws:" || url.protocol === "wss:") return;

  // Skip cross-origin requests (e.g., CDN resources)
  if (url.origin !== self.location.origin) return;

  const pathname = url.pathname;

  // ── API requests: network-first with cache fallback ──────────────────────
  if (pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful GET responses for offline fallback
          if (response.ok) {
            const clone = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          // Try cache on network failure
          const cached = await caches.match(event.request);
          if (cached) return cached;
          // Return a JSON error response so the app can handle it gracefully
          return new Response(JSON.stringify({ error: "offline", cached: false }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        })
    );
    return;
  }

  // ── Built JS/CSS chunks: cache-first with network fallback ─────────────────
  if (
    pathname.startsWith("/assets/") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css")
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached || new Response("Resource not available offline", { status: 503 }));
      })
    );
    return;
  }

  // ── Static assets (images, fonts, icons): stale-while-revalidate ──────────
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// ── Background sync for draft scores ──────────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-drafts") {
    event.waitUntil(syncDrafts());
  }
});

async function syncDrafts() {
  // The actual sync is handled by the useDraftStore composable in the page.
  // This sync event is a fallback for when the page is closed.
  // Notify all clients to trigger their sync
  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({ type: "SYNC_DRAFTS" });
  }
}

// ── Push notification support (for future use) ───────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || "评分系统", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "default",
      data: data.url ? { url: data.url } : undefined,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.notification.data?.url) {
    event.waitUntil(self.clients.openWindow(event.notification.data.url));
  }
});
