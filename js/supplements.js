/* supplements.js — the supplement list and adherence counting. Pure, no imports.
 *
 * Shape on the profile:   supplements: [{ id, name }]   (order is the display order)
 * Shape on a day doc:     supps: ['sup_ab12', 'sup_cd34']   (ids taken that day)
 *
 * Storing ids rather than names means renaming a supplement keeps its history.
 */

export const MAX_SUPPLEMENTS = 20;
export const MAX_NAME_LENGTH = 40;

export const newSupplementId = () =>
  'sup_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

/** Coerce whatever is on the profile into a clean, de-duplicated list. */
export function normalizeSupplements(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const id = typeof s.id === 'string' && s.id ? s.id : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: String(s.name ?? '').slice(0, MAX_NAME_LENGTH).trim() || 'Untitled' });
    if (out.length >= MAX_SUPPLEMENTS) break;
  }
  return out;
}

/** The ids taken on a day, filtered to ones that still exist on the profile. */
export function takenOn(day, supplements) {
  const live = new Set(supplements.map((s) => s.id));
  return (day?.supps || []).filter((id) => live.has(id));
}

/**
 * Adherence over a set of day documents.
 *
 * The denominator is every day in the range, not just days you logged food —
 * a day you took nothing still counts against you, which is the whole point.
 *
 * A supplement you have since deleted is ignored, even where day docs still
 * carry its id: it is no longer something you are trying to take, so counting
 * it would drag `allDays` down forever.
 */
export function supplementStats(days, supplements) {
  const list = normalizeSupplements(supplements);
  const totalDays = Array.isArray(days) ? days.length : 0;

  const counts = new Map(list.map((s) => [s.id, 0]));
  let allDays = 0;
  let anyDays = 0;

  for (const day of days || []) {
    const taken = new Set(takenOn(day, list));
    if (taken.size) anyDays++;
    for (const id of taken) counts.set(id, counts.get(id) + 1);
    if (list.length && taken.size === list.length) allDays++;
  }

  return {
    totalDays,
    allDays,
    anyDays,
    perSupplement: list.map((s) => ({
      id: s.id,
      name: s.name,
      days: counts.get(s.id),
      pct: totalDays ? counts.get(s.id) / totalDays : 0,
    })),
  };
}

/** Toggle one id within a day's list, returning a new array. */
export function toggleSupp(current, id, taken) {
  const set = new Set(current || []);
  if (taken) set.add(id); else set.delete(id);
  return Array.from(set);
}
