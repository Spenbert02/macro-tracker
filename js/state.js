/* state.js — tiny pub/sub store. Deliberately imports nothing. */

const state = {
  user:    null,   // firebase User
  profile: null,   // users/{uid}
  dayKey:  null,   // the day currently shown on the Entry page
  today:   null,   // the day doc for dayKey (yes, the name is aspirational)
  pending: false,  // that doc has unsynced local writes
  foods:   [],     // users/{uid}/foods, newest-used first
  meals:   [],     // users/{uid}/meals
  range:   30,     // Viewer time range, in days (0 = all)
  online:  typeof navigator === 'undefined' ? true : navigator.onLine,
  ready:   false,  // first profile snapshot has landed
};

const subs = new Set();

export const getState = () => state;

export function setState(patch) {
  let changed = false;
  for (const k of Object.keys(patch)) {
    if (state[k] !== patch[k]) { state[k] = patch[k]; changed = true; }
  }
  if (changed) emit(Object.keys(patch));
}

function emit(keys) {
  for (const fn of Array.from(subs)) {
    try { fn(state, keys); } catch (err) { console.error('[state] subscriber threw', err); }
  }
}

/** subscribe(fn) or subscribe(['today','profile'], fn) */
export function subscribe(keysOrFn, maybeFn) {
  const keys = typeof keysOrFn === 'function' ? null : keysOrFn;
  const fn   = typeof keysOrFn === 'function' ? keysOrFn : maybeFn;
  const wrapped = keys
    ? (s, changed) => { if (changed.some((k) => keys.includes(k))) fn(s, changed); }
    : fn;
  subs.add(wrapped);
  return () => subs.delete(wrapped);
}

if (typeof window !== 'undefined') {
  addEventListener('online',  () => setState({ online: true }));
  addEventListener('offline', () => setState({ online: false }));
}
