/* A stand-in for js/store.js so the UI can be exercised without Firebase. */
import { sumEntries } from '../../js/macros.js';
import { addDays, localDayKey } from '../../js/dates.js';

export const MAX_ENTRIES_PER_DAY = 200;
export const calls = [];
const log = (name, ...args) => { calls.push({ name, args }); };

export const blankProfile = () => ({
  targets: { p: 180, c: 250, f: 70, kcal: 2400 },
  modes: { p: 'min', c: 'max', f: 'max', kcal: 'band' },
  bandPct: 0.05, targetGainLbPerMonth: -2, tz: 'America/Chicago', weightUnit: 'lb',
});
export const normalizeProfile = (r) => ({ ...blankProfile(), ...(r || {}) });

export const ENTRIES = [
  { id: 'e_1', name: 'Clif Bar — Chocolate Chip', brand: 'CLIF', foodId: 'off_0722252100900',
    servings: 1.5, servingLabel: '1 bar (68 g)', p: 10, c: 43, f: 6, kcal: 250, mealId: null, at: Date.now() - 6e6 },
  { id: 'e_2', name: 'Morning shake', foodId: null, servings: 1, p: 48, c: 6, f: 2, kcal: 240,
    mealId: 'm_1', at: Date.now() - 3e6 },
  { id: 'e_3', name: 'Chicken breast', servings: 2, servingLabel: '4 oz', p: 31, c: 0, f: 3.6, kcal: 165,
    mealId: null, at: Date.now() - 1e6 },
];

const today = () => ({
  date: localDayKey(new Date(), 'America/Chicago'),
  weightLb: 182.4, entries: ENTRIES, totals: sumEntries(ENTRIES),
});

export const blankDay = (k) => ({ date: k, weightLb: null, entries: [], totals: { p:0,c:0,f:0,kcal:0 } });

export function watchProfile(uid, cb) { cb(blankProfile(), true); return () => {}; }
export function watchDay(uid, key, cb) { cb(today(), false); return () => {}; }
export const getDay = async () => today();

function fakeRange(n) {
  const end = localDayKey(new Date(), 'America/Chicago');
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(end, -i);
    if (i % 7 === 3) continue;                      // deliberate gaps
    const scale = 0.7 + Math.sin(i / 4) * 0.25;
    const entries = [{ id: 'x', name: 'f', servings: 1, p: 150 * scale, c: 230 * scale, f: 68 * scale, kcal: 2250 * scale }];
    out.push({ date, weightLb: i % 3 === 0 ? Math.round((184 - (n - i) * 0.03) * 10) / 10 : null,
               entries, totals: sumEntries(entries) });
  }
  return out;
}
export const getDayRange = async (uid, a, b) => fakeRange(60);
export const getAllDays  = async () => fakeRange(200);

export const addEntry = async (...a) => log('addEntry', ...a);
export const addEntries = async (...a) => log('addEntries', ...a);
export const updateEntry = async (...a) => log('updateEntry', ...a);
export const removeEntry = async (...a) => log('removeEntry', ...a);
export const removeEntries = async (...a) => log('removeEntries', ...a);
export const setWeight = async (...a) => log('setWeight', ...a);
export const saveProfile = async (...a) => log('saveProfile', ...a);

export const FOODS = [
  { id: 'off_0722252100900', name: 'Clif Bar — Chocolate Chip', brand: 'CLIF', servingLabel: '1 bar (68 g)',
    per: { p: 10, c: 43, f: 6, kcal: 250 }, per100g: { p: 14.7, c: 63.2, f: 8.8, kcal: 368 },
    barcode: '0722252100900', lastUsedAt: Date.now() },
  { id: 'c_whey', name: 'Whey scoop', servingLabel: '1 scoop (31 g)',
    per: { p: 24, c: 3, f: 1, kcal: 120 }, lastUsedAt: Date.now() - 1e6 },
];
export function watchFoods(uid, cb) { cb(FOODS); return () => {}; }
export const getFoodByBarcode = async (uid, code) => FOODS.find((f) => f.barcode === code) || null;
export const upsertFood = async (...a) => { log('upsertFood', ...a); return a[1]; };
export const saveFood = async (...a) => log('saveFood', ...a);
export const deleteFood = async (...a) => log('deleteFood', ...a);
export const getAllFoods = async () => FOODS;

export const MEALS = [
  { id: 'm_1', name: 'Morning shake', items: [
      { foodId: 'c_whey', name: 'Whey scoop', servings: 2, servingLabel: '1 scoop (31 g)', per: { p: 24, c: 3, f: 1, kcal: 120 } }],
    totals: { p: 48, c: 6, f: 2, kcal: 240 }, lastUsedAt: Date.now() },
];
export function watchMeals(uid, cb) { cb(MEALS); return () => {}; }
export const saveMeal = async (...a) => { log('saveMeal', ...a); return a[1]; };
export const touchMeal = async (...a) => log('touchMeal', ...a);
export const deleteMeal = async (...a) => log('deleteMeal', ...a);
export const getAllMeals = async () => MEALS;
export const exportAll = async () => ({ profile: blankProfile(), days: fakeRange(10), foods: FOODS, meals: MEALS });
