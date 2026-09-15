/* off.js — Open Food Facts lookup.
 *
 * Their rate limit is 15 product reads per minute per IP, with a stated
 * willingness to IP-ban. We stay far under it by caching every result as a food
 * document, so a given product is fetched at most once, ever.
 *
 * Their policy also asks for an identifying User-Agent, which a browser simply
 * cannot set (it is a forbidden header name for fetch). The app_name/app_version/
 * app_uuid query params below are the closest identification available to us.
 */

import { OFF_APP_NAME, APP_VERSION } from './config.js';
import { kjToKcal, round } from './macros.js';

const BASE = 'https://world.openfoodfacts.org/api/v2/product';

const FIELDS = [
  'code', 'product_name', 'product_name_en', 'generic_name', 'brands', 'quantity',
  'serving_size', 'serving_quantity', 'serving_quantity_unit', 'nutrition_data_per',
  'image_front_small_url', 'image_small_url', 'nutriments',
].join(',');

/** A stable per-install id, so OFF can see one client rather than many. */
function appUuid() {
  try {
    let v = localStorage.getItem('mt_uuid');
    if (!v) {
      v = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem('mt_uuid', v);
    }
    return v;
  } catch { return 'no-storage'; }
}

/**
 * Digits only. A 12-digit UPC-A is the same article as the 13-digit GTIN with a
 * leading zero, and OFF stores the 13-digit form — so we try both.
 */
export function normalizeBarcode(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 12) return '0' + d;          // UPC-A -> GTIN-13
  return d;
}

/** The forms worth trying, in order, for a scanned code. */
export function barcodeVariants(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  const out = [];
  const push = (v) => { if (v && !out.includes(v)) out.push(v); };
  push(d);
  if (d.length === 12) push('0' + d);
  if (d.length === 13 && d.startsWith('0')) push(d.slice(1));
  return out;
}

export const isPlausibleBarcode = (code) => /^\d{8}$|^\d{12,14}$/.test(String(code || '').replace(/\D/g, ''));

/**
 * Fetch one product. Returns the raw OFF product object, or null if not found.
 *
 * Note: OFF answers "not found" with HTTP 200 and status: 0, so the HTTP status
 * code tells you nothing. Always check json.status.
 */
export async function fetchProduct(barcode, { timeoutMs = 8000 } = {}) {
  const codes = barcodeVariants(barcode);
  for (const code of codes) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const url = `${BASE}/${encodeURIComponent(code)}.json`
        + `?fields=${FIELDS}`
        + `&app_name=${encodeURIComponent(OFF_APP_NAME)}`
        + `&app_version=${encodeURIComponent(APP_VERSION)}`
        + `&app_uuid=${encodeURIComponent(appUuid())}`;
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (res.status === 429) throw new RateLimited();
      if (!res.ok) continue;
      const json = await res.json();
      if (json?.status === 1 && json.product) return { ...json.product, code: json.code || code };
    } catch (err) {
      if (err instanceof RateLimited) throw err;
      if (err?.name === 'AbortError') throw new Error('Open Food Facts took too long to answer.');
      // otherwise fall through and try the next code form
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export class RateLimited extends Error {
  constructor() { super('Open Food Facts is rate-limiting us. Wait a minute, or enter it by hand.'); }
}

/* ---------------- nutriment extraction ---------------- */

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Calories for a given suffix ('serving' or '100g').
 *
 * This function is the whole reason the kJ bug does not exist in this app.
 * OFF's `energy_100g` field carries whatever unit the contributor used — for a
 * Clif bar it is 1710.29 kJ. Reading it as calories would log a 250 kcal bar as
 * 1710. So: take energy-kcal_* when present, convert energy-kj_* when not, and
 * only fall back to the ambiguous `energy_*` after checking its stated unit.
 */
function energyKcal(nut, suffix) {
  const kcal = n(nut[`energy-kcal_${suffix}`]);
  if (kcal !== null) return kcal;

  const kj = n(nut[`energy-kj_${suffix}`]);
  if (kj !== null) return kjToKcal(kj);

  const generic = n(nut[`energy_${suffix}`]);
  if (generic === null) return null;
  const unit = String(nut[`energy_unit`] || nut[`energy_${suffix}_unit`] || '').toLowerCase();
  return unit === 'kcal' ? generic : kjToKcal(generic);
}

const macroSet = (nut, suffix) => ({
  p:    n(nut[`proteins_${suffix}`]),
  c:    n(nut[`carbohydrates_${suffix}`]),
  f:    n(nut[`fat_${suffix}`]),
  kcal: energyKcal(nut, suffix),
});

const complete = (m) => m && m.p !== null && m.c !== null && m.f !== null && m.kcal !== null;

const rounded = (m) => m && ({
  p: round(m.p, 1), c: round(m.c, 1), f: round(m.f, 1), kcal: round(m.kcal, 0),
});

/**
 * OFF product -> our food shape.
 *
 * Prefers per-serving figures when the product actually has a serving defined,
 * else falls back to per-100g and labels the serving "100 g" so the number the
 * user sees always matches the number being added.
 *
 * Missing macros stay null — shown as "?" and required before saving. Coercing
 * them to 0 would quietly log a meal as free.
 */
export function toFood(product) {
  if (!product) return null;
  const nut = product.nutriments || {};

  const per100  = macroSet(nut, '100g');
  const perServ = macroSet(nut, 'serving');

  const servingLabel = (product.serving_size || '').trim();
  const useServing = complete(perServ) && !!servingLabel;

  const name = (product.product_name_en || product.product_name || product.generic_name || '').trim();
  const brand = (product.brands || '').split(',')[0].trim();

  return {
    id: `off_${product.code}`,
    source: 'off',
    barcode: String(product.code),
    name: name || `Item ${product.code}`,
    brand: brand || null,
    servingLabel: useServing ? servingLabel : '100 g',
    servingGrams: useServing
      ? (String(product.serving_quantity_unit || 'g').toLowerCase() === 'g' ? n(product.serving_quantity) : null)
      : 100,
    per: rounded(useServing ? perServ : per100) || { p: null, c: null, f: null, kcal: null },
    per100g: complete(per100) ? rounded(per100) : null,
    imageUrl: product.image_front_small_url || product.image_small_url || null,
    quantity: product.quantity || null,
    fetchedAt: Date.now(),
  };
}
