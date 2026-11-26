/* Video2Notes – secure proxy (Cloudflare Worker). Keeps the AI keys on the server, never in the web page.
   Secrets (set with `wrangler secret put`):  OPENAI_API_KEY, ANTHROPIC_API_KEY (optional), ACCESS_CODES (comma-separated)
   Variables: ALLOWED_ORIGIN (e.g. https://yourname.github.io), MAX_BODY_MB (default 25)
   Routes:  POST /openai/v1/audio/transcriptions | POST /openai/v1/chat/completions | POST /anthropic/v1/messages | GET /health
   The page sends the header  X-Access-Code.  Nothing is stored or logged by this worker. */
const ROUTES = {
  'openai/v1/audio/transcriptions': ['https://api.openai.com/v1/audio/transcriptions', 'OPENAI_API_KEY', k => ({ Authorization: 'Bearer ' + k })],
  'openai/v1/chat/completions': ['https://api.openai.com/v1/chat/completions', 'OPENAI_API_KEY', k => ({ Authorization: 'Bearer ' + k })],
  'anthropic/v1/messages': ['https://api.anthropic.com/v1/messages', 'ANTHROPIC_API_KEY', k => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' })],
};
const json = (o, status, cors) => new Response(JSON.stringify(o), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors) });
const eq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '', allowed = env.ALLOWED_ORIGIN || '';
    const cors = { 'Access-Control-Allow-Origin': allowed && origin === allowed ? origin : (allowed ? 'null' : '*'), 'Access-Control-Allow-Headers': 'X-Access-Code, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (allowed && origin !== allowed) return json({ error: { message: 'Origin not allowed' } }, 403, cors);
    const path = new URL(req.url).pathname.replace(/^\/+/, '');
    if (path === 'health' && req.method === 'GET') return json({ ok: true, openai: !!env.OPENAI_API_KEY, anthropic: !!env.ANTHROPIC_API_KEY }, 200, cors);
    const route = ROUTES[path]; if (!route || req.method !== 'POST') return json({ error: { message: 'Not found' } }, 404, cors);
    const codes = String(env.ACCESS_CODES || '').split(',').map(s => s.trim()).filter(Boolean), got = req.headers.get('X-Access-Code') || '';
    if (!codes.length || !got || !codes.some(c => eq(c, got))) return json({ error: { message: 'Invalid access code' } }, 401, cors);
    const max = (+env.MAX_BODY_MB || 25) * 1048576, len = +req.headers.get('Content-Length') || 0;
    if (len > max) return json({ error: { message: 'Request too large' } }, 413, cors);
    const [url, keyName, hdr] = route, key = env[keyName]; if (!key) return json({ error: { message: 'This provider is not configured on the proxy' } }, 503, cors);
    const h = hdr(key), ct = req.headers.get('Content-Type'); if (ct) h['Content-Type'] = ct;
    const up = await fetch(url, { method: 'POST', headers: h, body: req.body });
    const out = new Headers(cors); out.set('Content-Type', up.headers.get('Content-Type') || 'application/json');
    return new Response(up.body, { status: up.status, headers: out });
  },
};
