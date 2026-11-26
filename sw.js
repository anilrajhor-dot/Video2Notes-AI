/* Video2Notes service worker. Lets the app open offline and serves the speech-engine files (cdn.jsdelivr.net) from cache.
   It never caches or touches AI-provider calls, proxy calls, or model downloads (those are stored by the app itself). */
const V = 'v2n-shell-3';
const SHELL = ['./', './asr-worker.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => e.waitUntil((async () => { const c = await caches.open(V); await c.addAll(SHELL); self.skipWaiting(); })()));
self.addEventListener('activate', e => e.waitUntil((async () => { for (const k of await caches.keys()) if (k.startsWith('v2n-shell') && k !== V) await caches.delete(k); await self.clients.claim(); })()));
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return; const u = new URL(r.url);
  const same = u.origin === location.origin, cdn = u.hostname === 'cdn.jsdelivr.net' && u.pathname.startsWith('/npm/');
  if (!same && !cdn) return;
  if (cdn) {            // engine files: cache-first from the app's own engine cache, never re-downloaded once stored
    e.respondWith((async () => { const hit = await caches.match(r, { ignoreVary: true }); if (hit) return hit; try { return await fetch(r); } catch (_) { return Response.error(); } })());
    return;
  }
  if (r.mode === 'navigate') {
    e.respondWith((async () => { try { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000); const n = await fetch(r, { signal: ctl.signal }); clearTimeout(t); if (n.ok) (await caches.open(V)).put('./', n.clone()); return n; } catch (_) { return (await caches.match('./')) || Response.error(); } })());
    return;
  }
  e.respondWith((async () => { const c = await caches.open(V); const hit = await c.match(r); const net = fetch(r).then(x => { if (x.ok) c.put(r, x.clone()); return x; }).catch(() => null); return hit || (await net) || Response.error(); })());
});
