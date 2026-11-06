// Minimal service worker so every browser treats Weekly Shop as installable.
// Network first for this site's own files, with the last good copy as an
// offline fallback. Firebase requests are left alone.
const CACHE = 'weekly-shop-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch (e) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      throw e;
    }
  })());
});

// Phone notifications (sent by the worker through Firebase Cloud Messaging as data messages).
self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data.json(); } catch { msg = { body: event.data && event.data.text() }; }
  const d = msg.data || msg.notification || msg;
  event.waitUntil(self.registration.showNotification(d.title || 'Weekly Shop', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag || undefined, data: { link: d.link || './' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.link || './', self.registration.scope).href;
  event.waitUntil((async () => {
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if (c.url.startsWith(self.registration.scope)) { await c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
