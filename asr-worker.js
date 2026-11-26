/* On-device speech recognition (Whisper through transformers.js / ONNX Runtime Web).
   Runs in a Web Worker so the interface never freezes. When allowRemote is false the engine is
   forbidden from using the network, so offline mode can never send audio anywhere. */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/';

const LANG = { en: 'english', hi: 'hindi', bn: 'bengali', ta: 'tamil', te: 'telugu', mr: 'marathi', gu: 'gujarati', pa: 'punjabi', kn: 'kannada', ml: 'malayalam', ur: 'urdu' };
let asr = null, device = 'wasm';

async function build(model, dev, onp) {
  const dtype = dev === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8';
  return pipeline('automatic-speech-recognition', model, { device: dev, dtype, progress_callback: onp });
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'load') {
      env.allowRemoteModels = !!m.allowRemote;
      const onp = p => self.postMessage({ type: 'progress', status: p.status, file: p.file, progress: p.progress, loaded: p.loaded, total: p.total });
      device = (m.webgpu && 'gpu' in navigator) ? 'webgpu' : 'wasm';
      try { asr = await build(m.model, device, onp); }
      catch (e) {
        if (device === 'webgpu' && m.allowRemote !== undefined) { device = 'wasm'; asr = await build(m.model, 'wasm', onp); } else throw e;
      }
      self.postMessage({ type: 'loaded', id: m.id, device });
    } else if (m.type === 'transcribe') {
      const opt = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true, task: 'transcribe' };
      if (m.language && LANG[m.language]) opt.language = LANG[m.language];
      const out = await asr(m.audio, opt);
      const segs = (out.chunks || []).map(c => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? c.timestamp[0] ?? 0, text: (c.text || '').trim() })).filter(s => s.text);
      if (!segs.length && (out.text || '').trim()) segs.push({ start: 0, end: 0, text: out.text.trim() });
      self.postMessage({ type: 'result', id: m.id, segs });
    }
  } catch (e) {
    let msg = String(e && e.message || e);
    if (/Failed to fetch|NetworkError|not allowed|Could not locate file|local_files_only|allowRemoteModels/i.test(msg) && m.type === 'load' && !m.allowRemote)
      msg = 'The speech model is not stored on this device. Install it from Settings while online.';
    self.postMessage({ type: 'error', id: m.id, message: msg });
  }
};
