/* scanner.js — camera capture and barcode decoding.
 *
 * Two decoders, because there is no single one that works everywhere:
 *   - BarcodeDetector, where the platform really has it (Chrome on Android).
 *     Safari ships the constructor behind a flag and its implementation has
 *     been broken since iOS 18, so a bare `'BarcodeDetector' in window` check
 *     is not enough — we ask getSupportedFormats() and still guard the first
 *     detect() call in a try/catch that falls back permanently.
 *   - @undecaf/zbar-wasm otherwise. Since the iPhone is the primary device,
 *     this is in practice the primary path, not the fallback.
 *
 * Note dist/inlined/index.mjs, not dist/index.js: the latter is an IIFE despite
 * what the README shows, and would fail as a module import. The inlined build
 * also embeds the .wasm, so there is no second network fetch to cache.
 */

const ZBAR_URL = 'https://cdn.jsdelivr.net/npm/@undecaf/zbar-wasm@0.11.0/dist/inlined/index.mjs';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];

let nativeChecked = null;
export async function isNativeDetectorUsable() {
  if (nativeChecked !== null) return nativeChecked;
  nativeChecked = false;
  try {
    if (typeof BarcodeDetector === 'undefined') return false;
    const supported = await BarcodeDetector.getSupportedFormats();
    nativeChecked = supported.includes('ean_13') && supported.includes('upc_a');
  } catch { nativeChecked = false; }
  return nativeChecked;
}

let zbarPromise = null;
const loadZbar = () => (zbarPromise ||= import(/* @vite-ignore */ ZBAR_URL));

/**
 * Open the camera and decode.
 *
 * IMPORTANT: `stream` must be obtained by the CALLER, synchronously inside the
 * tap handler, and handed in. iOS discards the user-gesture token across an
 * await, so calling getUserMedia after any await silently fails to prompt.
 */
export function startScan({ stream, videoEl, onResult, onError, onStatus }) {
  let stopped = false;
  let lastCode = null;       // require the same code twice running before trusting it
  let rafId = null;
  let intervalId = null;
  let detector = null;
  let useNative = false;
  let scanning = false;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', '');   // iOS refuses to inline-play without this
  videoEl.muted = true;

  function stop() {
    if (stopped) return;
    stopped = true;
    if (rafId && videoEl.cancelVideoFrameCallback) videoEl.cancelVideoFrameCallback(rafId);
    cancelAnimationFrame(rafId);
    clearInterval(intervalId);
    for (const track of stream.getTracks()) { try { track.stop(); } catch {} }
    videoEl.srcObject = null;
  }

  function succeed(code) {
    if (stopped) return;
    navigator.vibrate?.(30);
    stop();
    onResult(code);
  }

  /** Two consecutive identical reads. Phone cameras misread a digit often enough. */
  function offer(code) {
    const clean = String(code || '').replace(/\D/g, '');
    if (clean.length < 8) return;
    if (clean === lastCode) succeed(clean);
    else lastCode = clean;
  }

  /** Crop the middle band: faster to decode, and ignores neighbouring barcodes. */
  function grabFrame() {
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh) return null;
    const cw = Math.round(vw * 0.82);
    const ch = Math.round(vh * 0.42);
    const sx = Math.round((vw - cw) / 2);
    const sy = Math.round((vh - ch) / 2);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.drawImage(videoEl, sx, sy, cw, ch, 0, 0, cw, ch);
    return { cw, ch };
  }

  async function tick() {
    if (stopped || scanning) return;
    scanning = true;
    try {
      const box = grabFrame();
      if (box) {
        if (useNative) {
          try {
            const found = await detector.detect(canvas);
            if (found?.length) offer(found[0].rawValue);
          } catch (err) {
            // Safari's flagged implementation throws here. Never try it again.
            console.warn('[scan] native detector failed, using zbar', err);
            useNative = false;
            nativeChecked = false;
            onStatus?.('Switching decoder…');
            await ensureZbar();
          }
        } else if (zbar) {
          const imageData = ctx.getImageData(0, 0, box.cw, box.ch);
          const symbols = await zbar.scanImageData(imageData);
          if (symbols?.length) offer(symbols[0].decode());
        }
      }
    } catch (err) {
      console.warn('[scan] frame error', err);
    } finally {
      scanning = false;
      schedule();
    }
  }

  let zbar = null;
  async function ensureZbar() {
    if (zbar) return;
    onStatus?.('Loading decoder…');
    zbar = await loadZbar();
    onStatus?.(null);
  }

  function schedule() {
    if (stopped) return;
    if (videoEl.requestVideoFrameCallback) {
      rafId = videoEl.requestVideoFrameCallback(() => tick());
    } else {
      clearTimeout(intervalId);
      intervalId = setTimeout(tick, 120);
    }
  }

  (async () => {
    try {
      await videoEl.play().catch(() => {});
      useNative = await isNativeDetectorUsable();
      if (useNative) detector = new BarcodeDetector({ formats: FORMATS });
      else await ensureZbar();
      if (stopped) return;
      onStatus?.(null);
      schedule();
    } catch (err) {
      if (!stopped) { stop(); onError?.(err); }
    }
  })();

  return { stop, isNative: () => useNative };
}

/**
 * Must be called synchronously from a user gesture — do not await anything
 * before it. Returns the promise; await that afterwards.
 */
export function requestCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('This browser has no camera API.'));
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
}

export function cameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was denied. Allow it in your browser settings, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera found on this device.';
    case 'NotReadableError':
      return 'The camera is already in use by another app.';
    default:
      return err?.message || 'Could not open the camera.';
  }
}

/** getUserMedia only exists on a secure origin — https, or localhost for dev. */
export const cameraAvailable = () =>
  !!navigator.mediaDevices?.getUserMedia && (window.isSecureContext !== false);
