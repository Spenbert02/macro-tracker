/* entryModel.js — the shape of a logged item, plus error phrasing.
 * Pure: shared by entryPage and addFoodSheet without dragging either into the other.
 */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const newId = (prefix = '') =>
  prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

/**
 * A day entry stores macros PER ONE SERVING plus a servings multiplier, so
 * editing the servings later never needs the original food document.
 */
export function makeEntry(food, servings, mealId = null) {
  return {
    id: newId('e_'),
    name: food.name || 'Untitled',
    brand: food.brand || null,
    foodId: food.id || null,
    servings: Number(servings) || 1,
    servingLabel: food.servingLabel || null,
    imageUrl: food.imageUrl || null,
    p: num(food.per?.p), c: num(food.per?.c), f: num(food.per?.f), kcal: num(food.per?.kcal),
    mealId,
    at: Date.now(),
  };
}

export const friendly = (err) => {
  if (err?.code === 'permission-denied') {
    return 'The database refused that. Check that your UID is in firestore.rules and that you published them.';
  }
  if (err?.code === 'unavailable') {
    return "Can't reach the database. Your change is saved on this device and will sync.";
  }
  return err?.message || 'Something went wrong.';
};
