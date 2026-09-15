/* macros.js — all macro arithmetic and goal evaluation. Pure, no imports.
 *
 * The only four things this app tracks: protein (p), carbs (c), fat (f),
 * calories (kcal). Nothing else, ever.
 */

export const MACROS = ['p', 'c', 'f', 'kcal'];
export const MACRO_LABEL = { p: 'Protein', c: 'Carbs', f: 'Fat', kcal: 'Calories' };
export const MACRO_LETTER = { p: 'P', c: 'C', f: 'F', kcal: 'kcal' };
export const MACRO_UNIT = { p: 'g', c: 'g', f: 'g', kcal: '' };

export const ZERO = Object.freeze({ p: 0, c: 0, f: 0, kcal: 0 });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Round to at most `dp` decimals, dropping float fuzz like 64.50000000000001. */
export const round = (n, dp = 1) => {
  const m = 10 ** dp;
  return Math.round((num(n) + Number.EPSILON) * m) / m;
};

/** Atwater factors. Used by the "= 4P + 4C + 9F" button and the sanity check. */
export const kcalFromMacros = (p, c, f) => num(p) * 4 + num(c) * 4 + num(f) * 9;

/** An entry stores macros PER ONE SERVING; this multiplies out. */
export function scaleEntry(entry) {
  const s = num(entry?.servings);
  return {
    p:    round(num(entry?.p) * s, 2),
    c:    round(num(entry?.c) * s, 2),
    f:    round(num(entry?.f) * s, 2),
    kcal: round(num(entry?.kcal) * s, 2),
  };
}

/** Day totals. The single source of truth for the `totals` field on a day doc. */
export function sumEntries(entries) {
  const t = { p: 0, c: 0, f: 0, kcal: 0 };
  for (const e of entries || []) {
    const s = scaleEntry(e);
    t.p += s.p; t.c += s.c; t.f += s.f; t.kcal += s.kcal;
  }
  return { p: round(t.p, 1), c: round(t.c, 1), f: round(t.f, 1), kcal: round(t.kcal, 0) };
}

/**
 * Meal items nest their macros under `per`; day entries carry them flat. This
 * flattens the former so the same arithmetic serves both.
 */
export const flattenItem = (item) => ({
  servings: item?.servings,
  p:    item?.per ? item.per.p    : item?.p,
  c:    item?.per ? item.per.c    : item?.c,
  f:    item?.per ? item.per.f    : item?.f,
  kcal: item?.per ? item.per.kcal : item?.kcal,
});

/** Totals for a list of MEAL ITEMS (macros under `per`). */
export const sumItems = (items) => sumEntries((items || []).map(flattenItem));

/* ---------- goal evaluation ----------
 * 'min'  — hit when value >= target        (protein: a floor)
 * 'max'  — hit when value <= target        (carbs/fat: a ceiling)
 * 'band' — hit when |value - target| <= target * bandPct   (calories: a window)
 *
 * Per the spec there are exactly two states: hit (green) or miss (red).
 * An empty day is a miss — you have not hit the goal at 6am, so it is red.
 */
export function goalStatus(value, target, mode = 'min', bandPct = 0.05) {
  const v = num(value), t = num(target);
  if (!(t > 0)) return 'hit';        // no target set => nothing to miss
  if (mode === 'max')  return v <= t ? 'hit' : 'miss';
  if (mode === 'band') return Math.abs(v - t) <= t * Math.abs(num(bandPct)) ? 'hit' : 'miss';
  return v >= t ? 'hit' : 'miss';    // 'min'
}

/** Fraction of target, clamped to [0,1], for the progress bars. */
export const progress = (value, target) =>
  num(target) > 0 ? Math.max(0, Math.min(1, num(value) / num(target))) : 0;

/**
 * Does the calorie count roughly match 4P + 4C + 9F?
 * Catches the Open Food Facts kJ-vs-kcal trap (a kJ figure is ~4.18x too big)
 * and plain bad crowd-sourced data. Returns null when there is nothing to check.
 */
export function plausibility(per, tolerance = 0.25) {
  if (!per) return null;
  const { p, c, f, kcal } = per;
  if ([p, c, f, kcal].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const derived = kcalFromMacros(p, c, f);
  if (derived < 10 && kcal < 10) return null;          // both ~zero: nothing to say
  if (derived < 10) return 'suspect';                  // calories with no macros behind them
  const ratio = kcal / derived;
  if (ratio > 3.5 && ratio < 5) return 'kj';           // almost certainly kilojoules
  return Math.abs(kcal - derived) <= derived * tolerance ? 'ok' : 'suspect';
}

/** kJ -> kcal. */
export const kjToKcal = (kj) => num(kj) / 4.184;

/* ---------- formatting ---------- */

export const fmtInt = (n) => Math.round(num(n)).toLocaleString();

/** Servings read best as 1, 1.5, 0.25 — never 1.0 or 1.4999999. */
export function fmtServings(n) {
  const v = round(n, 2);
  return Number.isInteger(v) ? String(v) : String(v);
}

export const fmtGrams = (n) => {
  const v = round(n, 1);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

export const DEFAULT_TARGETS   = Object.freeze({ p: 160, c: 220, f: 70, kcal: 2200 });
export const DEFAULT_MODES     = Object.freeze({ p: 'min', c: 'max', f: 'max', kcal: 'band' });
export const DEFAULT_BAND_PCT  = 0.05;
