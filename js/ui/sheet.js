/* sheet.js — the bottom-sheet shell everything modal uses. */

import { h, mount, clear } from './dom.js';

const root = () => document.getElementById('sheet-root');

/**
 * openSheet({ title, onClose }) -> { body, foot, head, setTitle, close, el }
 * `body` is the scrolling area; write into it with mount().
 */
export function openSheet({ title = '', onClose = null, closeLabel = 'Close' } = {}) {
  const titleEl = h('h2', null, title);
  const body = h('div', { class: 'sheet-body' });
  const foot = h('div', { class: 'sheet-foot', hidden: true });
  const head = h('div', { class: 'sheet-head' },
    titleEl,
    h('button', { class: 'btn btn-ghost', onclick: () => close() }, closeLabel),
  );

  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'grabber' }), head, body, foot);

  const scrim = h('div', { class: 'scrim', onclick: () => close() });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    scrim.remove(); el.remove();
    onClose?.();
  }

  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  addEventListener('keydown', onKey);

  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';   // stop the page scrolling behind the sheet

  root().append(scrim, el);
  // Focus the sheet so screen readers and Escape land in the right place.
  setTimeout(() => el.querySelector('input, button')?.focus({ preventScroll: true }), 40);

  return {
    el, head, body, foot,
    setTitle: (t) => { titleEl.textContent = t; },
    showFoot: (...children) => { foot.hidden = false; mount(foot, ...children); },
    hideFoot: () => { foot.hidden = true; clear(foot); },
    close,
    isClosed: () => closed,
  };
}
