/* dates.js — local-timezone day keys. Pure, no imports.
 *
 * A "day key" is a YYYY-MM-DD string in the USER'S timezone, and it is the
 * Firestore document id for that day.
 *
 * Never use `new Date().toISOString().slice(0,10)` anywhere in this app — that
 * is UTC, so in US Central everything logged after 7pm would file under
 * tomorrow. Intl with an explicit timeZone is the only correct way.
 */

export const deviceTz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
};

const keyFmt = new Map();
function keyFormatter(tz) {
  let f = keyFmt.get(tz);
  if (!f) {
    // en-CA formats as YYYY-MM-DD natively, which is exactly the key shape.
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    keyFmt.set(tz, f);
  }
  return f;
}

/** Date -> 'YYYY-MM-DD' in the given timezone. */
export function localDayKey(date = new Date(), tz = deviceTz()) {
  try { return keyFormatter(tz).format(date); }
  catch { return keyFormatter('UTC').format(date); }
}

export const isDayKey = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Day-key arithmetic done on the calendar, never via a UTC Date round-trip. */
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  // UTC noon: far enough from either midnight that no DST shift can move the date.
  const t = Date.UTC(y, m - 1, d, 12) + n * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Whole days from keyA to keyB (b - a). */
export function daysBetween(a, b) {
  const p = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}

/** The n day keys ending at (and including) endKey, oldest first. */
export function rangeKeys(endKey, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = addDays(endKey, i - n + 1);
  return out;
}

/** A Date at noon local-ish, safe for formatting a day key for display. */
const asDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};

const dayFmt  = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const longFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const tickFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export const prettyDay = (key) => dayFmt.format(asDate(key));      // 'Mon, Sep 15'
export const longDay   = (key) => longFmt.format(asDate(key));     // 'Monday, September 15, 2026'
export const tickLabel = (key) => tickFmt.format(asDate(key));     // 'Sep 15'

export const isToday     = (key, tz = deviceTz()) => key === localDayKey(new Date(), tz);
export const isFuture    = (key, tz = deviceTz()) => key > localDayKey(new Date(), tz);

/** 'Today' / 'Yesterday' / '' — the subtitle under the day label. */
export function relativeDay(key, tz = deviceTz()) {
  const today = localDayKey(new Date(), tz);
  const diff = daysBetween(today, key);
  if (diff === 0)  return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1)  return 'Tomorrow';
  return '';
}
