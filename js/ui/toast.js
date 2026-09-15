/* toast.js — transient messages. */

import { h, icon, ICONS } from './dom.js';

const root = () => document.getElementById('toast-root');

function show(message, { kind = '', timeout = 3200, action = null } = {}) {
  const el = h('div', { class: `toast ${kind}`.trim() },
    kind === 'err' ? icon(ICONS.warn, 16) : null,
    h('span', null, message),
    action ? h('button', {
      onclick: () => { dismiss(); action.onClick(); },
    }, action.label) : null,
  );

  const dismiss = () => {
    clearTimeout(timer);
    el.style.opacity = '0';
    el.style.transition = 'opacity .15s';
    setTimeout(() => el.remove(), 160);
  };

  const timer = timeout ? setTimeout(dismiss, timeout) : null;
  if (!action) el.addEventListener('click', dismiss);
  root()?.append(el);
  return dismiss;
}

export const toast   = (msg, opts)   => show(msg, opts);
export const toastOk  = (msg, opts)  => show(msg, { kind: 'ok', ...opts });
export const toastErr = (msg, opts)  => show(msg, { kind: 'err', timeout: 5200, ...opts });
