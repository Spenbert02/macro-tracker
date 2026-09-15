/* entryPage.js — the main screen: today's totals, weight, and the day's items. */

import { h, mount, clear, icon, ICONS, debounce } from './dom.js';
import { friendly } from '../entryModel.js';
import { getState, setState, subscribe } from '../state.js';
import { localDayKey, prettyDay, relativeDay, addDays, isFuture, deviceTz } from '../dates.js';
import {
  sumEntries, scaleEntry, goalStatus, progress, fmtInt, fmtGrams, fmtServings,
  MACRO_LETTER, DEFAULT_TARGETS, DEFAULT_MODES, DEFAULT_BAND_PCT,
} from '../macros.js';
import { toast, toastOk, toastErr } from './toast.js';
import { normalizeSupplements, toggleSupp } from '../supplements.js';

let subs = [];

export function render(root) {
  subs.forEach((u) => u()); subs = [];

  const dayStrip   = h('div', { class: 'daystrip' });
  const kcalCard   = h('div', { class: 'card kcal-card' });
  const macroGrid  = h('div', { class: 'macro-grid' });
  const weightCard = h('div', { class: 'card weight-card' });
  const suppCard   = h('div', { class: 'card supp-card', hidden: true });
  const listHead   = h('div', { class: 'section-head' });
  const list       = h('div', { class: 'entry-list' });
  const pendingRow = h('div', { class: 'pending', hidden: true }, icon(ICONS.refresh, 14), h('span'));
  const selectBar  = h('div', { class: 'selectbar', hidden: true });

  const addBtn = h('div', { class: 'addbar' },
    h('button', {
      class: 'btn btn-primary btn-block',
      onclick: async () => {
        const { openAddFood } = await import('./addFoodSheet.js');
        openAddFood();
      },
    }, icon(ICONS.plus, 20), 'Add food'),
  );

  mount(root, dayStrip, kcalCard, macroGrid, weightCard, suppCard, listHead, list, pendingRow, selectBar, addBtn);

  /* ---- selection mode (for building a meal out of what you already logged) ---- */
  let selected = new Set();
  const clearSelection = () => { selected = new Set(); paintList(); paintSelectBar(); };

  function paintSelectBar() {
    if (!selected.size) { selectBar.hidden = true; return; }
    selectBar.hidden = false;
    mount(selectBar,
      h('span', { class: 'grow small' }, `${selected.size} selected`),
      h('button', { class: 'btn btn-sm', onclick: clearSelection }, 'Cancel'),
      h('button', {
        class: 'btn btn-sm btn-primary',
        onclick: async () => {
          const { openSaveMeal } = await import('./mealEditor.js');
          const entries = (getState().today?.entries || []).filter((e) => selected.has(e.id));
          clearSelection();
          openSaveMeal(entries);
        },
      }, 'Save as meal'),
      h('button', {
        class: 'btn btn-sm btn-danger',
        onclick: async () => {
          const ids = Array.from(selected);
          clearSelection();
          await mutate((s, u, key) => s.removeEntries(u, key, ids), `Removed ${ids.length} items`);
        },
      }, 'Delete'),
    );
  }

  /* ---- day strip ---- */
  function paintDayStrip() {
    const { dayKey, profile } = getState();
    if (!dayKey) return;
    const tz = profile?.tz || deviceTz();
    const rel = relativeDay(dayKey, tz);
    const nextDisabled = isFuture(addDays(dayKey, 1), tz);

    mount(dayStrip,
      h('button', { 'aria-label': 'Previous day', onclick: () => go(-1) }, icon(ICONS.left)),
      h('button', {
        class: 'center-btn',
        onclick: () => { saveSupps.flush(); setState({ dayKey: localDayKey(new Date(), tz) }); },
        title: 'Jump to today',
      },
        h('span', { class: 'day-label' }, prettyDay(dayKey)),
        h('span', { class: 'day-sub' }, rel || dayKey),
      ),
      h('button', { 'aria-label': 'Next day', disabled: nextDisabled, onclick: () => go(1) }, icon(ICONS.right)),
    );
  }

  const go = (n) => {
    const { dayKey, profile } = getState();
    const next = addDays(dayKey, n);
    if (isFuture(next, profile?.tz || deviceTz())) return;
    clearSelection();
    saveSupps.flush();
    setState({ dayKey: next });
  };

  /* ---- the big numbers ---- */
  function paintTotals() {
    const { today, profile } = getState();
    const totals  = today?.totals || sumEntries(today?.entries || []);
    const targets = profile?.targets || DEFAULT_TARGETS;
    const modes   = profile?.modes   || DEFAULT_MODES;
    const band    = profile?.bandPct ?? DEFAULT_BAND_PCT;

    /* calories */
    const kStatus = goalStatus(totals.kcal, targets.kcal, modes.kcal, band);
    kcalCard.className = `card kcal-card goal-${kStatus}`;
    const left = Math.round((targets.kcal || 0) - totals.kcal);
    mount(kcalCard,
      h('div', { class: 'kcal-value tnum' },
        fmtInt(totals.kcal),
        h('span', { class: 'of' }, ' / ', fmtInt(targets.kcal)),
      ),
      h('div', { class: 'kcal-unit' }, 'calories'),
      h('span', { class: 'bar' },
        h('i', { style: { width: `${progress(totals.kcal, targets.kcal) * 100}%` } }),
        modes.kcal === 'band' && targets.kcal
          ? h('u', { style: { left: `${Math.min(100, (1 - band) * 100)}%` }, title: 'lower edge of target band' })
          : null,
      ),
      h('div', { class: 'kcal-note muted' },
        left > 0 ? `${fmtInt(left)} to go` : left < 0 ? `${fmtInt(-left)} over` : 'Right on target'),
    );

    /* protein / carbs / fat */
    mount(macroGrid, ...['p', 'c', 'f'].map((k) => {
      const status = goalStatus(totals[k], targets[k], modes[k], band);
      return h('div', { class: `macro-tile goal-${status}` },
        h('div', { class: 'val tnum' }, fmtGrams(totals[k]), h('span', { style: 'font-size:.5em;font-weight:600' }, 'g')),
        h('div', { class: 'target tnum' },
          '/ ', fmtGrams(targets[k]), 'g ',
          h('span', { class: 'letter' }, MACRO_LETTER[k]),
        ),
        h('span', { class: 'bar' }, h('i', { style: { width: `${progress(totals[k], targets[k]) * 100}%` } })),
      );
    }));
  }

  /* ---- weight ---- */
  const weightInput = h('input', {
    type: 'number', inputmode: 'decimal', step: '0.1', min: '0', max: '2000',
    placeholder: '—', 'aria-label': 'Body weight in pounds',
  });
  const weightState = h('span', { class: 'save-state' });
  let weightDirty = false;

  const saveWeight = debounce(async () => {
    const raw = weightInput.value.trim();
    const lb = raw === '' ? null : Number(raw);
    if (lb !== null && (!Number.isFinite(lb) || lb <= 0 || lb > 2000)) {
      mount(weightState, icon(ICONS.warn, 18)); weightState.className = 'save-state';
      return;
    }
    mount(weightState, icon(ICONS.refresh, 18));
    weightState.className = 'save-state busy';
    try {
      const { dayKey, user } = getState();
      const s = await import('../store.js');
      await s.setWeight(user.uid, dayKey, lb);
      weightDirty = false;
      mount(weightState, icon(ICONS.check, 18));
      weightState.className = 'save-state ok';
      setTimeout(() => { if (!weightDirty) clear(weightState); }, 2200);
    } catch (err) {
      weightState.className = 'save-state';
      clear(weightState);
      toastErr(friendly(err));
    }
  }, 800);

  weightInput.addEventListener('input', () => { weightDirty = true; saveWeight(); });
  weightInput.addEventListener('blur', () => saveWeight.flush());

  mount(weightCard,
    h('label', { for: 'weight-in', class: 'grow' }, 'Weight'),
    weightInput, h('span', { class: 'unit' }, 'lb'), weightState,
  );
  weightInput.id = 'weight-in';

  function paintWeight() {
    if (weightDirty || document.activeElement === weightInput) return;
    const w = getState().today?.weightLb;
    weightInput.value = w === null || w === undefined ? '' : String(w);
  }

  /* ---- supplements ----
   * Ticking a box updates a local set and repaints immediately, then writes the
   * whole array after a short pause. Firestore queues the write offline, so a
   * tap feels instant whether or not there is a connection.
   *
   * The pending set carries the day key it belongs to. Without that, stepping
   * to another day inside the debounce window would land the write on the day
   * you just moved to. */
  let suppDirty = null;          // { key, ids } while a write is pending
  const suppState = h('span', { class: 'save-state' });

  const saveSupps = debounce(async () => {
    const pending = suppDirty;
    if (!pending) return;
    const { user } = getState();
    mount(suppState, icon(ICONS.refresh, 16));
    suppState.className = 'save-state busy';
    try {
      const s = await import('../store.js');
      await s.setSupps(user.uid, pending.key, pending.ids);
      if (suppDirty === pending) suppDirty = null;
      mount(suppState, icon(ICONS.check, 16));
      suppState.className = 'save-state ok';
      setTimeout(() => { if (!suppDirty) clear(suppState); }, 2000);
    } catch (err) {
      if (suppDirty === pending) suppDirty = null;
      suppState.className = 'save-state';
      clear(suppState);
      toastErr(friendly(err));
      paintSupps();
    }
  }, 500);

  function paintSupps() {
    const { today, profile, dayKey } = getState();
    const list = normalizeSupplements(profile?.supplements);

    // Nothing configured yet: stay out of the way entirely.
    if (!list.length) { suppCard.hidden = true; return; }
    suppCard.hidden = false;

    const local = suppDirty?.key === dayKey ? suppDirty.ids : null;
    const taken = new Set(local || today?.supps || []);
    const done = list.filter((sup) => taken.has(sup.id)).length;

    mount(suppCard,
      h('div', { class: 'supp-head' },
        h('span', { class: 'supp-title' }, 'Supplements'),
        h('span', { class: `supp-count tnum${done === list.length ? ' all' : ''}` }, `${done}/${list.length}`),
        suppState,
      ),
      h('div', { class: 'supp-list' }, ...list.map((sup) => {
        const box = h('input', {
          type: 'checkbox', checked: taken.has(sup.id),
          onchange: () => {
            suppDirty = { key: dayKey, ids: toggleSupp(Array.from(taken), sup.id, box.checked) };
            navigator.vibrate?.(12);
            paintSupps();
            saveSupps();
          },
        });
        return h('label', { class: `supp${taken.has(sup.id) ? ' on' : ''}` }, box, h('span', null, sup.name));
      })),
    );
  }

  /* ---- entry list ---- */
  function paintList() {
    const { today, pending } = getState();
    const entries = (today?.entries || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));

    mount(listHead,
      h('h2', null, 'Logged'),
      h('span', { class: 'meta' }, entries.length ? `${entries.length} item${entries.length > 1 ? 's' : ''}` : ''),
    );

    if (!entries.length) {
      mount(list, h('div', { class: 'empty' },
        'Nothing logged yet.', h('br'),
        h('span', { class: 'tiny' }, 'Tap Add food to scan a barcode or enter something by hand.')));
    } else {
      mount(list, ...entries.map(renderEntry));
    }

    pendingRow.hidden = !pending;
    if (pending) pendingRow.lastChild.textContent = 'Saving… your changes are stored on this device until it syncs.';
  }

  function renderEntry(e) {
    const t = scaleEntry(e);
    const isSel = selected.has(e.id);

    const toggle = () => {
      if (isSel) selected.delete(e.id); else selected.add(e.id);
      paintList(); paintSelectBar();
    };

    let longPressTimer = null;
    const startPress = () => { longPressTimer = setTimeout(() => { navigator.vibrate?.(18); toggle(); }, 480); };
    const endPress = () => { clearTimeout(longPressTimer); };

    return h('div', {
      class: `entry${isSel ? ' selected' : ''}`,
      onpointerdown: startPress,
      onpointerup: endPress,
      onpointercancel: endPress,
      onpointerleave: endPress,
      oncontextmenu: (ev) => { ev.preventDefault(); },
      onclick: async (ev) => {
        if (ev.target.closest('.del')) return;
        if (selected.size) return toggle();
        const { openEditEntry } = await import('./addFoodSheet.js');
        openEditEntry(e);
      },
    },
      e.imageUrl ? h('img', { class: 'thumb', src: e.imageUrl, alt: '', loading: 'lazy' }) : null,
      h('div', { class: 'grow' },
        h('div', { class: 'name' },
          e.name || 'Untitled',
          e.mealId ? h('span', { class: 'chip' }, 'meal') : null,
        ),
        h('div', { class: 'sub tnum' },
          `${fmtInt(t.kcal)} kcal · P${fmtGrams(t.p)} C${fmtGrams(t.c)} F${fmtGrams(t.f)}`,
          e.servingLabel ? ` · ${e.servingLabel}` : '',
        ),
      ),
      h('span', { class: 'servings tnum' }, '×', fmtServings(e.servings)),
      h('button', {
        class: 'del', 'aria-label': `Remove ${e.name || 'item'}`,
        onclick: async (ev) => {
          ev.stopPropagation();
          await removeWithUndo(e);
        },
      }, icon(ICONS.trash, 17)),
    );
  }

  async function removeWithUndo(entry) {
    const { user, dayKey } = getState();
    const s = await import('../store.js');
    try {
      await s.removeEntry(user.uid, dayKey, entry.id);
      toast(`Removed ${entry.name || 'item'}`, {
        action: { label: 'Undo', onClick: () => s.addEntry(user.uid, dayKey, entry).catch((e) => toastErr(friendly(e))) },
      });
    } catch (err) { toastErr(friendly(err)); }
  }

  async function mutate(fn, okMsg) {
    const { user, dayKey } = getState();
    try {
      const s = await import('../store.js');
      await fn(s, user.uid, dayKey);
      if (okMsg) toastOk(okMsg);
    } catch (err) { toastErr(friendly(err)); }
  }

  /* ---- wire up ---- */
  const paintAll = () => { paintDayStrip(); paintTotals(); paintWeight(); paintSupps(); paintList(); };
  subs.push(subscribe(['today', 'profile', 'dayKey', 'pending'], paintAll));
  paintAll();

  return {
    destroy() {
      subs.forEach((u) => u()); subs = [];
      saveWeight.cancel();
      saveSupps.flush();      // don't lose a tick the user just made
    },
  };
}


