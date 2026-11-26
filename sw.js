/* Video2Notes (static edition) service worker: lets the APP open offline. AI work offline needs the on-device model. */
const V = 'v2n-static-1';
const SHELL = ['./', './asr-worker.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const CDN = ['https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'];
self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(V); await c.addAll(SHELL);
  for (const u of CDN) { try { await c.add(new Request(u, { mode: 'cors' })); } catch (_) {} }
  self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== V && k.startsWith('v2n-static')) await caches.delete(k); await self.clients.claim(); })()));
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return; const u = new URL(r.url);
  const sameOrigin = u.origin === location.origin, cdn = u.hostname === 'cdn.jsdelivr.net';
  if (!sameOrigin && !cdn) return;                 // AI provider calls and model downloads are never touched
  if (r.mode === 'navigate') {
    e.respondWith((async () => { try { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000); const n = await fetch(r, { signal: ctl.signal }); clearTimeout(t); if (n.ok) (await caches.open(V)).put('./', n.clone()); return n; } catch (_) { return (await caches.match('./')) || Response.error(); } })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(V); const hit = await c.match(r); if (hit && cdn) return hit;
    const net = fetch(r).then(x => { if (x.ok || x.type === 'opaque') c.put(r, x.clone()); return x; }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
