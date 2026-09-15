/* scanView.js — the full-screen camera overlay. */

import { h, mount } from './dom.js';
import { startScan, requestCamera, cameraError, cameraAvailable } from '../scanner.js';

/**
 * MUST be called synchronously from a tap handler — it calls getUserMedia
 * before doing anything else, because iOS throws away the user-gesture token
 * the moment you await.
 *
 * Resolves with a barcode string, or null if the user backed out.
 */
export function openScanner() {
  const streamPromise = cameraAvailable()
    ? requestCamera()
    : Promise.reject(new Error('Camera needs a secure (https) connection.'));

  return new Promise((resolve) => {
    let scan = null;
    let settled = false;

    const video = h('video', { playsinline: true, autoplay: true, muted: true });
    const status = h('p', null, 'Starting camera…');
    const torchBtn = h('button', { hidden: true }, 'Light');
    const manualBtn = h('button', { class: 'btn' }, 'Enter it by hand');

    const overlay = h('div', { class: 'scanview', role: 'dialog', 'aria-label': 'Barcode scanner' },
      video,
      h('div', { class: 'scan-overlay' },
        h('div', { class: 'scan-top' },
          h('h2', null, 'Scan a barcode'),
          torchBtn,
          h('button', { onclick: () => finish(null) }, 'Cancel'),
        ),
        h('div', { class: 'scan-mid' }, h('div', { class: 'reticle' })),
        h('div', { class: 'scan-bottom' }, status, manualBtn),
      ),
    );

    manualBtn.onclick = () => finish('__manual__');

    function finish(result) {
      if (settled) return;
      settled = true;
      try { scan?.stop(); } catch {}
      streamPromise.then((s) => s.getTracks().forEach((t) => { try { t.stop(); } catch {} })).catch(() => {});
      removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }

    const onKey = (ev) => { if (ev.key === 'Escape') finish(null); };
    addEventListener('keydown', onKey);

    document.body.append(overlay);

    streamPromise.then((stream) => {
      if (settled) { stream.getTracks().forEach((t) => t.stop()); return; }

      setupTorch(stream, torchBtn);

      scan = startScan({
        stream, videoEl: video,
        onResult: (code) => finish(code),
        onError:  (err) => { status.textContent = cameraError(err); },
        onStatus: (msg) => { status.textContent = msg || 'Point the camera at the barcode.'; },
      });
    }).catch((err) => {
      status.textContent = cameraError(err);
      mount(status.parentElement,
        h('p', null, cameraError(err)),
        manualBtn,
        h('button', { class: 'btn', onclick: () => finish(null) }, 'Close'),
      );
    });
  });
}

/** Torch is a no-op on iOS (no capability), so the button only shows if real. */
function setupTorch(stream, btn) {
  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.();
  if (!caps || !('torch' in caps)) return;
  let on = false;
  btn.hidden = false;
  btn.onclick = async () => {
    on = !on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      btn.textContent = on ? 'Light off' : 'Light';
    } catch { btn.hidden = true; }
  };
}
