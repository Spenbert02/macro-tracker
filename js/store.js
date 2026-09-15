/* store.js — THE ONLY MODULE THAT IMPORTS firebase/firestore.
 *
 * Data model
 *   users/{uid}                     profile: targets, goal modes, tz, prefs
 *   users/{uid}/days/{YYYY-MM-DD}   one doc per day, holding an entries array
 *   users/{uid}/foods/{foodId}      food library AND the offline barcode cache
 *   users/{uid}/meals/{mealId}      saved meals
 *
 * One doc per day, not one per entry: a 365-day chart costs 365 reads instead of
 * ~4,400, which is the difference between ~136 and ~11 full-year loads before
 * the 50k/day free-tier cap. The cost is last-write-wins if two devices edit the
 * same day at once, which for a single user is fine.
 */

import {
  doc, collection, query, where, orderBy, limit,
  getDoc, getDocs, setDoc, deleteDoc, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { sumEntries, sumItems, round, DEFAULT_TARGETS, DEFAULT_MODES, DEFAULT_BAND_PCT } from './macros.js';
import { deviceTz } from './dates.js';

export const MAX_ENTRIES_PER_DAY = 200;   // a 1 MiB doc fits ~5,000; this is a sanity rail

const userRef  = (uid) => doc(db, 'users', uid);
const dayRef   = (uid, key) => doc(db, 'users', uid, 'days', key);
const foodsCol = (uid) => collection(db, 'users', uid, 'foods');
const mealsCol = (uid) => collection(db, 'users', uid, 'meals');

/* ---------------- profile ---------------- */

export function blankProfile() {
  return {
    targets:  { ...DEFAULT_TARGETS },
    modes:    { ...DEFAULT_MODES },
    bandPct:  DEFAULT_BAND_PCT,
    /* Target rate of weight change, in pounds per month. Positive to gain,
     * negative to lose, 0 to turn the projection off. */
    targetGainLbPerMonth: 0,
    tz:       deviceTz(),
    weightUnit: 'lb',
  };
}

/** Fills in anything a partially-written profile is missing. */
export function normalizeProfile(raw) {
  const base = blankProfile();
  if (!raw) return base;
  return {
    ...base, ...raw,
    targets: { ...base.targets, ...(raw.targets || {}) },
    modes:   { ...base.modes,   ...(raw.modes   || {}) },
    bandPct: typeof raw.bandPct === 'number' ? raw.bandPct : base.bandPct,
    targetGainLbPerMonth: typeof raw.targetGainLbPerMonth === 'number' ? raw.targetGainLbPerMonth : 0,
    tz:      raw.tz || base.tz,
  };
}

export function watchProfile(uid, cb) {
  return onSnapshot(userRef(uid),
    (snap) => cb(normalizeProfile(snap.exists() ? snap.data() : null), snap.exists()),
    (err) => cb(null, false, err));
}

export const saveProfile = (uid, patch) =>
  setDoc(userRef(uid), { ...patch, updatedAt: serverTimestamp() }, { merge: true });

/* ---------------- days ---------------- */

export function blankDay(key) {
  return { date: key, weightLb: null, entries: [], totals: { p: 0, c: 0, f: 0, kcal: 0 } };
}

const normalizeDay = (key, raw) => ({ ...blankDay(key), ...(raw || {}), date: key, entries: raw?.entries || [] });

/**
 * Live day doc. Fires immediately from the local cache, again for local pending
 * writes, and again when the server confirms — so the UI is always showing the
 * truth including unsynced edits. `pending` drives the "1 change pending" line.
 */
export function watchDay(uid, key, cb) {
  return onSnapshot(dayRef(uid, key), { includeMetadataChanges: true },
    (snap) => cb(normalizeDay(key, snap.exists() ? snap.data() : null), snap.metadata.hasPendingWrites),
    (err) => cb(blankDay(key), false, err));
}

export async function getDay(uid, key) {
  const snap = await getDoc(dayRef(uid, key));
  return normalizeDay(key, snap.exists() ? snap.data() : null);
}

/** Days in [startKey, endKey], oldest first. Single-field range + order: auto-indexed. */
export async function getDayRange(uid, startKey, endKey) {
  const snap = await getDocs(query(
    collection(db, 'users', uid, 'days'),
    where('date', '>=', startKey),
    where('date', '<=', endKey),
    orderBy('date'),
  ));
  return snap.docs.map((d) => normalizeDay(d.id, d.data()));
}

/** Every day ever recorded, oldest first — for the "All" range and export. */
export async function getAllDays(uid) {
  const snap = await getDocs(query(collection(db, 'users', uid, 'days'), orderBy('date')));
  return snap.docs.map((d) => normalizeDay(d.id, d.data()));
}

/**
 * The one write path for entries.
 *
 * Deliberately NOT a transaction: runTransaction needs a server round-trip and
 * fails outright when offline, which would defeat the entire PWA. Instead we
 * read the current doc from the local cache, apply the mutation, recompute
 * totals from the resulting array, and setDoc(merge). That queues offline and
 * syncs on reconnect — and because totals are always derived from the array we
 * just wrote, they cannot drift out of sync with it.
 */
async function writeDay(uid, key, mutate) {
  const current = await getDay(uid, key);
  const entries = mutate(current.entries.slice(), current);
  if (entries.length > MAX_ENTRIES_PER_DAY) {
    throw new Error(`That would put more than ${MAX_ENTRIES_PER_DAY} items on one day.`);
  }
  await setDoc(dayRef(uid, key), {
    date: key,
    entries,
    totals: sumEntries(entries),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return entries;
}

export const addEntry = (uid, key, entry) =>
  writeDay(uid, key, (list) => [...list, entry]);

export const addEntries = (uid, key, newOnes) =>
  writeDay(uid, key, (list) => [...list, ...newOnes]);

export const updateEntry = (uid, key, entryId, patch) =>
  writeDay(uid, key, (list) => list.map((e) => (e.id === entryId ? { ...e, ...patch } : e)));

export const removeEntry = (uid, key, entryId) =>
  writeDay(uid, key, (list) => list.filter((e) => e.id !== entryId));

export const removeEntries = (uid, key, ids) =>
  writeDay(uid, key, (list) => list.filter((e) => !ids.includes(e.id)));

/** Weight is written on its own so it never rewrites the entries array. */
export const setWeight = (uid, key, lb) =>
  setDoc(dayRef(uid, key), {
    date: key,
    weightLb: lb === null || lb === '' ? null : round(Number(lb), 1),
    updatedAt: serverTimestamp(),
  }, { merge: true });

/* ---------------- foods ---------------- */

export function watchFoods(uid, cb) {
  return onSnapshot(query(foodsCol(uid), orderBy('lastUsedAt', 'desc'), limit(500)),
    (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
    (err) => cb([], err));
}

/**
 * Barcode lookup, served from Firestore's persistent local cache. This is why a
 * repeat scan is instant and works on a plane, and why Open Food Facts gets hit
 * at most once per distinct product, ever — which matters a lot against their
 * 15 requests/minute limit.
 */
export async function getFoodByBarcode(uid, barcode) {
  const snap = await getDoc(doc(db, 'users', uid, 'foods', `off_${barcode}`));
  return snap.exists() ? { ...snap.data(), id: snap.id } : null;
}

export async function upsertFood(uid, food) {
  const id = food.id || `c_${Math.random().toString(36).slice(2, 10)}`;
  await setDoc(doc(db, 'users', uid, 'foods', id), {
    ...food, id,
    useCount: (food.useCount || 0) + 1,
    lastUsedAt: Date.now(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return { ...food, id };
}

/** Save without counting it as a use (editing a food, not eating it). */
export const saveFood = (uid, food) =>
  setDoc(doc(db, 'users', uid, 'foods', food.id), { ...food, updatedAt: serverTimestamp() }, { merge: true });

export const deleteFood = (uid, foodId) => deleteDoc(doc(db, 'users', uid, 'foods', foodId));

export const getAllFoods = async (uid) =>
  (await getDocs(foodsCol(uid))).docs.map((d) => ({ ...d.data(), id: d.id }));

/* ---------------- meals ---------------- */

export function watchMeals(uid, cb) {
  return onSnapshot(query(mealsCol(uid), orderBy('lastUsedAt', 'desc'), limit(300)),
    (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
    (err) => cb([], err));
}

export async function saveMeal(uid, meal) {
  const id = meal.id || `m_${Math.random().toString(36).slice(2, 10)}`;
  const body = {
    ...meal, id,
    totals: sumItems(meal.items || []),
    lastUsedAt: meal.lastUsedAt || Date.now(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'users', uid, 'meals', id), body, { merge: true });
  return body;
}

export const touchMeal = (uid, mealId) =>
  setDoc(doc(db, 'users', uid, 'meals', mealId), { lastUsedAt: Date.now() }, { merge: true });

export const deleteMeal = (uid, mealId) => deleteDoc(doc(db, 'users', uid, 'meals', mealId));

export const getAllMeals = async (uid) =>
  (await getDocs(mealsCol(uid))).docs.map((d) => ({ ...d.data(), id: d.id }));

/* ---------------- export ---------------- */

export async function exportAll(uid) {
  const [profileSnap, days, foods, meals] = await Promise.all([
    getDoc(userRef(uid)), getAllDays(uid), getAllFoods(uid), getAllMeals(uid),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    schema: 1,
    profile: profileSnap.exists() ? profileSnap.data() : null,
    days, foods, meals,
  };
}
