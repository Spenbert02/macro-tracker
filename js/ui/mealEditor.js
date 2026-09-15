/* mealEditor.js — build and edit saved meals.
 *
 * A meal SNAPSHOTS the macros of each item rather than pointing at the food
 * documents. That way a meal renders offline, and correcting a food's numbers
 * later doesn't silently rewrite meals you logged months ago.
 */

import { h, mount, icon, ICONS } from './dom.js';
import { openSheet } from './sheet.js';
import { getState } from '../state.js';
import { toastOk, toastErr } from './toast.js';
import { friendly, newId } from '../entryModel.js';
import { sumItems, fmtInt, fmtGrams, fmtServings, round } from '../macros.js';

const itemFromEntry = (e) => ({
  foodId: e.foodId || null,
  name: e.name,
  servings: e.servings,
  servingLabel: e.servingLabel || null,
  per: { p: e.p, c: e.c, f: e.f, kcal: e.kcal },
});

const itemFromFood = (f, servings = 1) => ({
  foodId: f.id || null,
  name: f.name,
  servings,
  servingLabel: f.servingLabel || null,
  per: { p: f.per?.p || 0, c: f.per?.c || 0, f: f.per?.f || 0, kcal: f.per?.kcal || 0 },
});

/** Quick path: "Save as meal" from items already logged on a day. */
export function openSaveMeal(entries) {
  if (!entries?.length) return toastErr('Nothing selected.');
  openMealEditor({ id: null, name: '', items: entries.map(itemFromEntry) }, { title: 'Save as meal' });
}

export function openMealEditor(meal, { title = null } = {}) {
  const editing = !!meal?.id;
  const sheet = openSheet({ title: title || (editing ? 'Edit meal' : 'New meal'), closeLabel: 'Cancel' });

  let name = meal?.name || '';
  let items = (meal?.items || []).map((i) => ({ ...i }));

  const nameInput = h('input', { type: 'text', value: name, placeholder: 'e.g. Morning shake', required: true });
  nameInput.addEventListener('input', () => { name = nameInput.value; });

  const list = h('div');
  const totalsBox = h('div', { class: 'preview' });

  function paint() {
    const totals = sumItems(items);
    mount(totalsBox,
      h('div', null, h('div', { class: 'k' }, 'Calories'), h('div', { class: 'v tnum' }, fmtInt(totals.kcal))),
      h('div', null, h('div', { class: 'k' }, 'Protein'),  h('div', { class: 'v p tnum' }, fmtGrams(totals.p), 'g')),
      h('div', null, h('div', { class: 'k' }, 'Carbs'),    h('div', { class: 'v c tnum' }, fmtGrams(totals.c), 'g')),
      h('div', null, h('div', { class: 'k' }, 'Fat'),      h('div', { class: 'v f tnum' }, fmtGrams(totals.f), 'g')),
    );

    if (!items.length) {
      mount(list, h('div', { class: 'empty' }, 'No items yet — add some below.'));
      return;
    }

    mount(list, ...items.map((item, idx) => h('div', { class: 'list-row' },
      h('div', { class: 'grow' },
        h('div', { class: 'name' }, item.name),
        h('div', { class: 'sub tnum' },
          `${fmtInt((item.per.kcal || 0) * item.servings)} kcal`,
          item.servingLabel ? ` · ${item.servingLabel}` : ''),
      ),
      h('div', { class: 'stepper', style: 'gap:4px' },
        h('button', {
          style: 'width:32px;height:32px;font-size:1rem', 'aria-label': `Less ${item.name}`,
          onclick: () => { items[idx].servings = Math.max(0.25, round(item.servings - 0.25, 2)); paint(); },
        }, '−'),
        h('span', { class: 'tnum', style: 'min-width:34px;text-align:center;font-weight:700' }, fmtServings(item.servings)),
        h('button', {
          style: 'width:32px;height:32px;font-size:1rem', 'aria-label': `More ${item.name}`,
          onclick: () => { items[idx].servings = round(item.servings + 0.25, 2); paint(); },
        }, '+'),
      ),
      h('button', {
        class: 'btn btn-sm btn-ghost', 'aria-label': `Remove ${item.name}`,
        onclick: () => { items.splice(idx, 1); paint(); },
      }, icon(ICONS.trash, 16)),
    )));
  }

  const picker = h('div', { hidden: true });
  const search = h('input', { type: 'search', placeholder: 'Search your foods…', 'aria-label': 'Search foods' });

  function paintPicker() {
    const q = search.value.trim().toLowerCase();
    const foods = getState().foods
      .filter((f) => !q || `${f.name} ${f.brand || ''}`.toLowerCase().includes(q))
      .slice(0, 40);
    mount(picker,
      h('div', { class: 'field mt' }, search),
      foods.length
        ? h('div', null, ...foods.map((f) => h('button', {
            class: 'list-row',
            onclick: () => { items.push(itemFromFood(f)); paint(); },
          },
            h('div', { class: 'grow' },
              h('div', { class: 'name' }, f.name),
              h('div', { class: 'sub tnum' }, `${fmtInt(f.per?.kcal)} kcal`, f.servingLabel ? ` · ${f.servingLabel}` : '')),
            icon(ICONS.plus, 18),
          )))
        : h('div', { class: 'empty' },
            getState().foods.length ? 'Nothing matches that.'
              : 'You have no saved foods yet. Add some from the Entry page first.'),
    );
  }
  search.addEventListener('input', paintPicker);

  const addBtn = h('button', {
    class: 'btn btn-block mt',
    onclick: () => {
      picker.hidden = !picker.hidden;
      addBtn.lastChild.textContent = picker.hidden ? 'Add an item' : 'Done adding';
      if (!picker.hidden) paintPicker();
    },
  }, icon(ICONS.plus, 18), h('span', null, 'Add an item'));

  mount(sheet.body,
    h('label', { class: 'field' }, h('span', null, 'Meal name'), nameInput),
    h('div', { class: 'section-head' }, h('h2', null, 'Items')),
    list,
    addBtn,
    picker,
    h('div', { class: 'section-head' }, h('h2', null, 'Meal totals')),
    totalsBox,
  );
  paint();

  sheet.showFoot(
    h('div', { class: 'row' },
      editing ? h('button', {
        class: 'btn btn-danger',
        onclick: async () => {
          if (!confirm(`Delete the meal "${meal.name}"? Days you already logged it on are not affected.`)) return;
          try {
            const store = await import('../store.js');
            await store.deleteMeal(getState().user.uid, meal.id);
            sheet.close();
            toastOk('Meal deleted');
          } catch (err) { toastErr(friendly(err)); }
        },
      }, icon(ICONS.trash, 16)) : null,
      h('button', {
        class: 'btn btn-primary grow',
        onclick: async () => {
          if (!name.trim()) { nameInput.focus(); return toastErr('Give the meal a name.'); }
          if (!items.length) return toastErr('Add at least one item.');
          try {
            const store = await import('../store.js');
            await store.saveMeal(getState().user.uid, {
              id: meal?.id || `m_${newId()}`,
              name: name.trim(),
              items,
            });
            sheet.close();
            toastOk(editing ? 'Meal updated' : `Saved "${name.trim()}"`);
          } catch (err) { toastErr(friendly(err)); }
        },
      }, editing ? 'Save changes' : 'Save meal'),
    ),
  );

  return sheet;
}
