/* dom.js — a ~60-line element builder. No framework, no virtual DOM. */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'g', 'polyline', 'polygon']);

/**
 * h('div', { class: 'card', onclick: fn }, child, child)
 * Props: `class`, `style` (string or object), `dataset`, on* handlers, `html`
 * for trusted markup, anything else set as an attribute (or a property when the
 * value is not a string, so `hidden: true` and `disabled: false` behave).
 */
export function h(tag, props = null, ...children) {
  const el = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);

  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') el.setAttribute('class', v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'ref' && typeof v === 'function') v(el);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (typeof v === 'string' || typeof v === 'number') el.setAttribute(k, String(v));
    else el[k] = v;
  }

  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
};

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function mount(el, ...children) { clear(el); append(el, children); return el; }

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** An inline icon from the shared 24x24 path set. */
export const icon = (d, size = 20) =>
  h('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true' },
    ...(Array.isArray(d) ? d : [d]).map((p) => h('path', { d: p })));

export const ICONS = {
  plus:    'M12 5v14M5 12h14',
  minus:   'M5 12h14',
  close:   'M6 6l12 12M18 6L6 18',
  left:    'M15 18l-6-6 6-6',
  right:   'M9 18l6-6-6-6',
  check:   'M20 6L9 17l-5-5',
  trash:   'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  camera:  'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  search:  'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  warn:    'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  copy:    'M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  out:     'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  download:'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  bolt:    'M13 2L3 14h8l-1 8 10-12h-8z',
  book:    'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  pencil:  'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
};

/** Debounce that also exposes .flush() so a blur can commit immediately. */
export function debounce(fn, ms = 600) {
  let t, lastArgs;
  const run = () => { clearTimeout(t); t = null; if (lastArgs) { const a = lastArgs; lastArgs = null; fn(...a); } };
  const wrapped = (...args) => { lastArgs = args; clearTimeout(t); t = setTimeout(run, ms); };
  wrapped.flush = run;
  wrapped.cancel = () => { clearTimeout(t); lastArgs = null; };
  return wrapped;
}

export const uid = (prefix = '') =>
  prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
