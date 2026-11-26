/* On-device speech recognition (Whisper through transformers.js / ONNX Runtime Web), in a Web Worker.
   The library version is chosen by the page (the same version that was cached when the model was installed),
   so offline loading finds exactly the files that were stored. When allowRemote is false the engine may not use
   the network for model files, so offline mode can never send audio anywhere. */
const LANG = { en: 'english', hi: 'hindi', bn: 'bengali', ta: 'tamil', te: 'telugu', mr: 'marathi', gu: 'gujarati', pa: 'punjabi', kn: 'kannada', ml: 'malayalam', ur: 'urdu' };
let lib = null, asr = null, device = 'wasm', key = null;
// When the page says "no remote", every fetch made inside this worker (by the library, ONNX Runtime, anything) is answered
// from Cache Storage only. A cache miss fails immediately and NEVER reaches the network.
const realFetch = self.fetch.bind(self);
// Offline mode also closes every other way a worker could talk to a server.
const real = { XHR: self.XMLHttpRequest, WS: self.WebSocket, ES: self.EventSource, beacon: self.navigator && navigator.sendBeacon, imp: self.importScripts };
const BLOCK = what => { throw new TypeError('Network blocked (offline mode): ' + what); };
function lockOthers(locked) {
  try { self.XMLHttpRequest = locked ? function () { BLOCK('XMLHttpRequest'); } : real.XHR; } catch (_) { }
  try { self.WebSocket = locked ? function () { BLOCK('WebSocket'); } : real.WS; } catch (_) { }
  try { self.EventSource = locked ? function () { BLOCK('EventSource'); } : real.ES; } catch (_) { }
  try { if (self.navigator) navigator.sendBeacon = locked ? () => BLOCK('sendBeacon') : real.beacon; } catch (_) { }
  try { if (real.imp) self.importScripts = locked ? () => BLOCK('importScripts') : real.imp; } catch (_) { }
}
function setNetwork(allowed) {
  lockOthers(!allowed);
  self.fetch = allowed ? realFetch : async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const hit = await caches.match(req, { ignoreVary: true });
    if (hit) return hit;
    throw new TypeError('Network blocked (offline mode): ' + String(req.url).slice(0, 140));
  };
}

async function build(model, dev, onp) {
  const dtype = dev === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8';
  return lib.pipeline('automatic-speech-recognition', model, { device: dev, dtype, progress_callback: onp });
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'load') {
      setNetwork(!!m.allowRemote);
      const base = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${m.ver}/dist/`;
      if (!lib) {
        try { lib = await import(base + 'transformers.min.js'); }
        catch (e) { throw new Error('The speech engine files are not stored on this device' + (m.allowRemote ? ' and could not be downloaded.' : '. Open Settings while online and press "Install / repair".')); }
      }
      const env = lib.env; env.allowLocalModels = false; env.useBrowserCache = true; env.allowRemoteModels = !!m.allowRemote; env.backends.onnx.wasm.wasmPaths = base;
      const k = m.model + '|' + (m.webgpu ? 'g' : 'w') + '|' + (m.allowRemote ? 'r' : 'l');
      if (!asr || key !== k) {
        const onp = p => self.postMessage({ type: 'progress', status: p.status, file: p.file, progress: p.progress, loaded: p.loaded, total: p.total });
        device = (m.webgpu && 'gpu' in navigator) ? 'webgpu' : 'wasm';
        try { asr = await build(m.model, device, onp); }
        catch (e) { if (device === 'webgpu') { device = 'wasm'; asr = await build(m.model, 'wasm', onp); } else throw e; }
        key = k;
      }
      self.postMessage({ type: 'loaded', id: m.id, device });
    } else if (m.type === 'transcribe') {
      const opt = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true, task: 'transcribe' };
      if (m.language && LANG[m.language]) opt.language = LANG[m.language];
      const out = await asr(m.audio, opt);
      const segs = (out.chunks || []).map(c => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? c.timestamp[0] ?? 0, text: (c.text || '').trim() })).filter(s => s.text);
      if (!segs.length && (out.text || '').trim()) segs.push({ start: 0, end: 0, text: out.text.trim() });
      self.postMessage({ type: 'result', id: m.id, segs });
    } else if (m.type === 'reset') { asr = null; key = null; self.postMessage({ type: 'reset-done', id: m.id }); }
  } catch (e) {
    let msg = String(e && e.message || e);
    if (m.type === 'load' && !m.allowRemote && /Network blocked|Failed to fetch|NetworkError|not allowed|Could not locate file|local_files_only|allowRemoteModels|Unauthorized access|404/i.test(msg))
      msg = 'The speech model is not stored on this device. Open Settings while online and press "Install / repair".';
    self.postMessage({ type: 'error', id: m.id, message: msg });
  }
};
