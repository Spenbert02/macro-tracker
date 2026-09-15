/* addFoodSheet.js — everything that adds food to a day.
 *
 * Four tabs. Recent is default because for most real use it is the fastest
 * path: you eat the same twenty things over and over.
 */

import { h, mount, icon, ICONS } from './dom.js';
import { openSheet } from './sheet.js';
import { getState } from '../state.js';
import { toastOk, toastErr } from './toast.js';
import { makeEntry, friendly, newId } from '../entryModel.js';
import { kcalFromMacros, plausibility, round, fmtInt, fmtGrams, fmtServings } from '../macros.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* ============================ the sheet ============================ */

export function openAddFood() {
  const sheet = openSheet({ title: 'Add food', closeLabel: 'Cancel' });
  const tabsEl = h('div', { class: 'tabs' });
  sheet.el.insertBefore(tabsEl, sheet.body);

  const TABS = [
    { id: 'recent', label: 'Recent', render: renderRecent },
    { id: 'scan',   label: 'Scan',   render: renderScanTab },
    { id: 'meals',  label: 'Meals',  render: renderMeals },
    { id: 'manual', label: 'Manual', render: (s) => renderManual(s, {}) },
  ];

  let active = 'recent';
  function select(id) {
    active = id;
    for (const b of tabsEl.children) b.setAttribute('aria-selected', String(b.dataset.tab === id));
    sheet.hideFoot();
    TABS.find((t) => t.id === id).render(sheet);
  }

  mount(tabsEl, ...TABS.map((t) =>
    h('button', { dataset: { tab: t.id }, 'aria-selected': 'false', onclick: () => select(t.id) }, t.label)));

  select(active);
  return sheet;
}

/* ============================ recent ============================ */

function renderRecent(sheet) {
  const search = h('input', { type: 'search', placeholder: 'Search your foods…', 'aria-label': 'Search foods' });
  const results = h('div');
  mount(sheet.body, h('div', { class: 'field' }, search), results);

  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const foods = getState().foods
      .filter((f) => !q || `${f.name} ${f.brand || ''}`.toLowerCase().includes(q))
      .slice(0, 80);

    if (!foods.length) {
      mount(results, h('div', { class: 'empty' },
        getState().foods.length
          ? 'Nothing matches that.'
          : h('span', null, 'No saved foods yet.', h('br'),
              h('span', { class: 'tiny' }, 'Scan a barcode or add one by hand and it will show up here.'))));
      return;
    }

    mount(results, ...foods.map((f) => h('button', {
      class: 'list-row',
      onclick: () => renderConfirm(sheet, f, { servings: 1 }),
    },
      f.imageUrl ? h('img', { class: 'thumb', src: f.imageUrl, alt: '', loading: 'lazy' }) : null,
      h('div', { class: 'grow' },
        h('div', { class: 'name' }, f.name),
        h('div', { class: 'sub tnum' },
          `${fmtInt(f.per?.kcal)} kcal · P${fmtGrams(f.per?.p)} C${fmtGrams(f.per?.c)} F${fmtGrams(f.per?.f)}`,
          f.servingLabel ? ` · ${f.servingLabel}` : ''),
      ),
    )));
  };

  search.addEventListener('input', paint);
  paint();
}

/* ============================ scan ============================ */

function renderScanTab(sheet) {
  mount(sheet.body,
    h('div', { class: 'center', style: 'padding:20px 8px' },
      icon(ICONS.camera, 44),
      h('h3', { style: 'margin:14px 0 6px;font-size:1.05rem' }, 'Scan a barcode'),
      h('p', { class: 'small muted' }, 'Point the camera at the barcode on the package.'),
      h('button', {
        class: 'btn btn-primary btn-block mt-lg',
        // No await before openScanner(): iOS drops the gesture token and the
        // camera permission prompt never appears.
        onclick: () => {
          const scanning = import('./scanView.js').then((m) => m.openScanner());
          handleScan(sheet, scanning);
        },
      }, icon(ICONS.camera, 19), 'Open camera'),
      h('p', { class: 'tiny faint mt' }, 'Nutrition comes from Open Food Facts. If a product is missing you can enter it once by hand and it is saved for next time.'),
    ),
  );
}

/* The scan module is imported *inside* the handler above, so the getUserMedia
 * call it makes is still within the gesture. This function just consumes it. */
async function handleScan(sheet, scanningPromise) {
  let code;
  try { code = await scanningPromise; }
  catch (err) { return toastErr(err?.message || 'Could not open the camera.'); }

  if (code === null) return;                                  // cancelled
  if (code === '__manual__') return renderManual(sheet, {});   // "enter by hand"
  if (sheet.isClosed()) return;

  await lookupAndConfirm(sheet, code);
}

/** The lookup ladder: local cache -> Open Food Facts -> manual entry. */
async function lookupAndConfirm(sheet, code) {
  const { user } = getState();
  mount(sheet.body, h('div', { class: 'empty' }, 'Looking up ', h('code', null, code), '…'));

  const off = await import('../off.js');
  const store = await import('../store.js');
  const normalized = off.normalizeBarcode(code);

  // 1. Already known? Served from Firestore's local cache — instant, works offline.
  try {
    const cached = await store.getFoodByBarcode(user.uid, normalized);
    if (cached) {
      if (sheet.isClosed()) return;
      return renderConfirm(sheet, cached, { servings: 1, note: 'From your saved foods.' });
    }
  } catch (err) { console.warn('[scan] cache lookup failed', err); }

  // 2. Offline? Don't bother trying the network.
  if (!navigator.onLine) {
    if (sheet.isClosed()) return;
    return renderManual(sheet, {
      barcode: normalized,
      message: "You're offline, so this barcode can't be looked up. Enter it once by hand and it will be saved for next time.",
    });
  }

  // 3. Ask Open Food Facts.
  try {
    const product = await off.fetchProduct(normalized);
    if (sheet.isClosed()) return;
    if (!product) {
      return renderManual(sheet, {
        barcode: normalized,
        message: 'Open Food Facts has never heard of that barcode. Enter it once and it will be saved for next time.',
      });
    }
    const food = off.toFood(product);
    const missing = ['p', 'c', 'f', 'kcal'].some((k) => food.per[k] === null);
    if (missing) {
      return renderManual(sheet, {
        barcode: normalized, prefill: food,
        message: 'That product is missing some of its nutrition data. Fill in the gaps and it will be saved.',
      });
    }
    renderConfirm(sheet, food, { servings: 1, isNew: true });
  } catch (err) {
    if (sheet.isClosed()) return;
    renderManual(sheet, { barcode: normalized, message: err?.message || 'Lookup failed.' });
  }
}

/* ============================ meals ============================ */

function renderMeals(sheet) {
  const meals = getState().meals;
  const newBtn = h('button', {
    class: 'btn btn-block mt',
    onclick: async () => {
      const { openMealEditor } = await import('./mealEditor.js');
      sheet.close();
      openMealEditor(null);
    },
  }, icon(ICONS.plus, 18), 'New meal');

  if (!meals.length) {
    return mount(sheet.body,
      h('div', { class: 'empty' }, 'No saved meals yet.', h('br'),
        h('span', { class: 'tiny' }, 'Build one here, or long-press items on the Entry page and choose “Save as meal”.')),
      newBtn);
  }

  mount(sheet.body,
    ...meals.map((m) => h('div', { class: 'list-row' },
      h('button', {
        class: 'grow',
        style: 'background:none;border:0;text-align:left;padding:0;color:inherit',
        onclick: () => addMeal(sheet, m),
      },
        h('div', { class: 'name' }, m.name),
        h('div', { class: 'sub tnum' },
          `${fmtInt(m.totals?.kcal)} kcal · P${fmtGrams(m.totals?.p)} C${fmtGrams(m.totals?.c)} F${fmtGrams(m.totals?.f)}`,
          ` · ${m.items?.length || 0} item${m.items?.length === 1 ? '' : 's'}`),
      ),
      h('button', {
        class: 'btn btn-sm btn-ghost', 'aria-label': `Edit ${m.name}`,
        onclick: async () => {
          const { openMealEditor } = await import('./mealEditor.js');
          sheet.close();
          openMealEditor(m);
        },
      }, icon(ICONS.pencil, 16)),
    )),
    newBtn,
  );
}

async function addMeal(sheet, meal) {
  const { user, dayKey } = getState();
  try {
    const store = await import('../store.js');
    // One write for the whole meal, not one per item.
    const entries = (meal.items || []).map((item) => makeEntry(
      { id: item.foodId, name: item.name, servingLabel: item.servingLabel, per: item.per },
      item.servings, meal.id,
    ));
    if (!entries.length) return toastErr('That meal has no items in it.');
    await store.addEntries(user.uid, dayKey, entries);
    store.touchMeal(user.uid, meal.id).catch(() => {});
    sheet.close();
    toastOk(`Added ${meal.name}`);
  } catch (err) { toastErr(friendly(err)); }
}

/* ============================ manual ============================ */

function renderManual(sheet, { barcode = null, prefill = null, message = null, food = null } = {}) {
  sheet.setTitle(food ? 'Edit food' : 'Add manually');

  const src = food || prefill || {};
  const name    = h('input', { type: 'text', value: src.name || '', placeholder: 'e.g. Greek yogurt', required: true });
  const brand   = h('input', { type: 'text', value: src.brand || '', placeholder: 'optional' });
  const serving = h('input', { type: 'text', value: src.servingLabel || '', placeholder: 'e.g. 1 cup (170 g)' });

  const mk = (v) => h('input', { type: 'number', inputmode: 'decimal', step: 'any', min: '0', value: v ?? '', placeholder: '0' });
  const p = mk(src.per?.p), c = mk(src.per?.c), f = mk(src.per?.f), kcal = mk(src.per?.kcal);

  const warn = h('div', { class: 'alert alert-warn', hidden: true });

  const autoKcal = h('button', {
    class: 'btn btn-sm', type: 'button',
    title: 'Fill calories from the macros (4 x protein + 4 x carbs + 9 x fat)',
    onclick: () => { kcal.value = String(Math.round(kcalFromMacros(num(p.value) || 0, num(c.value) || 0, num(f.value) || 0))); check(); },
  }, '= 4P + 4C + 9F');

  function check() {
    const per = { p: num(p.value), c: num(c.value), f: num(f.value), kcal: num(kcal.value) };
    const verdict = plausibility(per);
    if (verdict === 'kj') {
      warn.hidden = false;
      warn.textContent = `Those macros work out to about ${Math.round(kcalFromMacros(per.p, per.c, per.f))} calories. The number you entered looks like kilojoules.`;
    } else if (verdict === 'suspect') {
      warn.hidden = false;
      warn.textContent = `Heads up: those macros work out to about ${Math.round(kcalFromMacros(per.p, per.c, per.f))} calories, not ${Math.round(per.kcal)}.`;
    } else { warn.hidden = true; }
  }
  [p, c, f, kcal].forEach((i) => i.addEventListener('input', check));

  const saveToFoods = h('input', { type: 'checkbox', checked: true, style: 'width:auto;min-height:0' });

  mount(sheet.body,
    message ? h('div', { class: 'alert alert-info' }, message) : null,
    barcode ? h('p', { class: 'tiny faint' }, 'Barcode ', h('code', null, barcode)) : null,

    h('label', { class: 'field' }, h('span', null, 'Name'), name),
    h('label', { class: 'field' }, h('span', null, 'Brand'), brand),
    h('label', { class: 'field' }, h('span', null, 'One serving is'), serving,
      h('span', { class: 'hint faint' }, 'Whatever you want a "serving" to mean. The macros below are for one of these.')),

    h('div', { class: 'section-head' }, h('h2', null, 'Per serving')),
    h('div', { class: 'macro-inputs' },
      h('label', { class: 'field' }, h('span', null, 'Protein (g)'), p),
      h('label', { class: 'field' }, h('span', null, 'Carbs (g)'), c),
      h('label', { class: 'field' }, h('span', null, 'Fat (g)'), f),
      h('label', { class: 'field' }, h('span', null, 'Calories'), kcal),
    ),
    h('div', { class: 'row mt' }, autoKcal),
    warn,

    h('label', { class: 'row mt-lg', style: 'gap:10px' }, saveToFoods,
      h('span', { class: 'small' }, 'Save to my foods so I can reuse it')),
  );
  check();

  sheet.showFoot(h('button', {
    class: 'btn btn-primary btn-block',
    onclick: () => {
      if (!name.value.trim()) { name.focus(); return toastErr('Give it a name.'); }
      const per = { p: num(p.value) ?? 0, c: num(c.value) ?? 0, f: num(f.value) ?? 0, kcal: num(kcal.value) ?? 0 };
      const built = {
        id: food?.id || (barcode ? `off_${barcode}` : `c_${newId()}`),
        source: barcode ? 'off-manual' : 'custom',
        barcode: barcode || food?.barcode || null,
        name: name.value.trim(),
        brand: brand.value.trim() || null,
        servingLabel: serving.value.trim() || '1 serving',
        per,
        per100g: src.per100g || null,
        imageUrl: src.imageUrl || null,
      };
      renderConfirm(sheet, built, { servings: 1, save: saveToFoods.checked });
    },
  }, 'Next'));
}

/* ============================ confirm + servings ============================ */

function renderConfirm(sheet, food, { servings = 1, note = null, save = true, isNew = false, editing = null } = {}) {
  sheet.setTitle(editing ? 'Edit item' : 'Add to day');

  let value = Number(servings) || 1;
  const input = h('input', {
    type: 'number', inputmode: 'decimal', step: '0.25', min: '0', value: String(value),
    'aria-label': 'Number of servings',
  });
  const preview = h('div', { class: 'preview' });
  const quick = h('div', { class: 'quick' });

  const set = (v) => {
    value = Math.max(0, round(v, 2));
    input.value = fmtServings(value);
    paint();
  };

  input.addEventListener('input', () => { value = Math.max(0, num(input.value) ?? 0); paint(); });

  function paint() {
    const t = {
      p: round((food.per?.p || 0) * value, 1),
      c: round((food.per?.c || 0) * value, 1),
      f: round((food.per?.f || 0) * value, 1),
      kcal: Math.round((food.per?.kcal || 0) * value),
    };
    mount(preview,
      h('div', null, h('div', { class: 'k' }, 'Calories'), h('div', { class: 'v tnum' }, fmtInt(t.kcal))),
      h('div', null, h('div', { class: 'k' }, 'Protein'),  h('div', { class: 'v p tnum' }, fmtGrams(t.p), 'g')),
      h('div', null, h('div', { class: 'k' }, 'Carbs'),    h('div', { class: 'v c tnum' }, fmtGrams(t.c), 'g')),
      h('div', null, h('div', { class: 'k' }, 'Fat'),      h('div', { class: 'v f tnum' }, fmtGrams(t.f), 'g')),
    );
    for (const b of quick.children) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === value));
  }

  mount(quick, ...[0.5, 1, 1.5, 2, 3].map((v) =>
    h('button', { dataset: { v }, 'aria-pressed': 'false', onclick: () => set(v) }, fmtServings(v))));

  const verdict = plausibility(food.per);

  mount(sheet.body,
    h('div', { class: 'row', style: 'gap:12px;align-items:flex-start' },
      food.imageUrl ? h('img', { class: 'thumb', style: 'width:56px;height:56px', src: food.imageUrl, alt: '' }) : null,
      h('div', { class: 'grow' },
        h('div', { style: 'font-weight:700;font-size:1.02rem' }, food.name),
        h('div', { class: 'small muted' },
          [food.brand, food.servingLabel].filter(Boolean).join(' · ') || ' '),
      ),
    ),

    note ? h('p', { class: 'tiny faint mt' }, note) : null,
    isNew ? h('p', { class: 'tiny faint mt' }, 'Found on Open Food Facts. It will be saved so the next scan is instant.') : null,

    verdict === 'kj' ? h('div', { class: 'alert alert-warn mt' },
      'Those macros suggest about ', fmtInt(kcalFromMacros(food.per.p, food.per.c, food.per.f)),
      ' calories, not ', fmtInt(food.per.kcal), '. This product’s data may be in kilojoules — check before adding.') : null,
    verdict === 'suspect' ? h('div', { class: 'alert alert-warn mt' },
      'The calories and the macros don’t quite agree (macros suggest about ',
      fmtInt(kcalFromMacros(food.per.p, food.per.c, food.per.f)), '). Crowd-sourced data is sometimes wrong.') : null,

    h('div', { class: 'section-head' }, h('h2', null, 'Servings')),
    h('div', { class: 'stepper' },
      h('button', { 'aria-label': 'Less', onclick: () => set(value - 0.25) }, '−'),
      input,
      h('button', { 'aria-label': 'More', onclick: () => set(value + 0.25) }, '+'),
    ),
    quick,
    preview,

    h('button', {
      class: 'btn btn-sm btn-ghost mt',
      onclick: () => renderManual(sheet, { food, barcode: food.barcode }),
    }, icon(ICONS.pencil, 15), 'Edit these numbers'),
  );
  paint();

  sheet.showFoot(h('button', {
    class: 'btn btn-primary btn-block',
    onclick: async () => {
      if (!(value > 0)) return toastErr('Servings has to be more than zero.');
      const { user, dayKey } = getState();
      try {
        const store = await import('../store.js');
        if (editing) {
          await store.updateEntry(user.uid, dayKey, editing.id, {
            servings: value,
            name: food.name, servingLabel: food.servingLabel,
            p: food.per.p, c: food.per.c, f: food.per.f, kcal: food.per.kcal,
          });
          sheet.close();
          toastOk('Updated');
        } else {
          await store.addEntry(user.uid, dayKey, makeEntry(food, value));
          if (save !== false) store.upsertFood(user.uid, food).catch((e) => console.warn('[food] save failed', e));
          sheet.close();
          toastOk(`Added ${food.name}`);
        }
      } catch (err) { toastErr(friendly(err)); }
    },
  }, editing ? 'Save changes' : 'Add to day'));
}

/* ============================ editing a logged item ============================ */

export function openEditEntry(entry) {
  const sheet = openSheet({ title: 'Edit item', closeLabel: 'Cancel' });
  const food = {
    id: entry.foodId,
    name: entry.name,
    brand: entry.brand,
    servingLabel: entry.servingLabel,
    imageUrl: entry.imageUrl,
    barcode: entry.foodId?.startsWith('off_') ? entry.foodId.slice(4) : null,
    per: { p: entry.p, c: entry.c, f: entry.f, kcal: entry.kcal },
  };
  renderConfirm(sheet, food, { servings: entry.servings, editing: entry });
  return sheet;
}
