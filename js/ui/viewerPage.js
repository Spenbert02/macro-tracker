/* viewerPage.js — graphs across time. */

import { h, mount } from './dom.js';
import { getState, subscribe } from '../state.js';
import { localDayKey, addDays, deviceTz } from '../dates.js';
import { goalStatus, fmtInt, round, DEFAULT_TARGETS, DEFAULT_MODES, DEFAULT_BAND_PCT } from '../macros.js';
import { friendly } from '../entryModel.js';
import { supplementStats } from '../supplements.js';

const RANGES = [
  { id: 7,   label: '7d'  },
  { id: 30,  label: '30d' },
  { id: 90,  label: '90d' },
  { id: 365, label: '1y'  },
  { id: 0,   label: 'All' },
];

const cache = new Map();          // range -> days[]; dropped whenever a day changes
let charts = null;
let subs = [];

export function render(root) {
  subs.forEach((u) => u()); subs = [];

  const seg = h('div', { class: 'segmented' });
  const stats = h('div', { class: 'stat-grid' });
  const body = h('div');

  mount(root, seg, stats, body);

  let range = getState().range || 30;

  function paintSeg() {
    mount(seg, ...RANGES.map((r) => h('button', {
      'aria-pressed': String(r.id === range),
      onclick: () => { range = r.id; paintSeg(); load(); },
    }, r.label)));
  }
  paintSeg();

  async function load() {
    mount(stats, h('div', { class: 'empty', style: 'grid-column:1/-1' }, 'Loading…'));
    mount(body, '');

    const { user, profile } = getState();
    const tz = profile?.tz || deviceTz();
    const endKey = localDayKey(new Date(), tz);

    let days;
    try {
      if (cache.has(range)) {
        days = cache.get(range);
      } else {
        const store = await import('../store.js');
        days = range === 0
          ? await store.getAllDays(user.uid)
          : await store.getDayRange(user.uid, addDays(endKey, -(range - 1)), endKey);
        cache.set(range, days);
      }
    } catch (err) {
      mount(stats, '');
      return mount(body, h('div', { class: 'alert' }, friendly(err)));
    }

    // Fill missing days so gaps in the chart are real gaps, not squeezed-out time.
    const filled = fillGaps(days, range, endKey);

    if (!days.length) {
      mount(stats, '');
      return mount(body, h('div', { class: 'empty' },
        'Nothing logged in this range yet.', h('br'),
        h('span', { class: 'tiny' }, 'Add some food on the Entry page and it will show up here.')));
    }

    paintStats(filled, profile);
    await paintCharts(filled, profile);
  }

  let rateStats = null;   // filled in once the charts module has computed the fit

  function paintStats(days, profile) {
    const targets = profile?.targets || DEFAULT_TARGETS;
    const modes   = profile?.modes   || DEFAULT_MODES;
    const band    = profile?.bandPct ?? DEFAULT_BAND_PCT;

    const logged = days.filter((d) => (d.entries || []).length);
    const avg = (k) => (logged.length
      ? round(logged.reduce((a, d) => a + (d.totals?.[k] || 0), 0) / logged.length, k === 'kcal' ? 0 : 1)
      : 0);

    const onTarget = logged.filter((d) =>
      ['p', 'c', 'f', 'kcal'].every((k) => goalStatus(d.totals?.[k] || 0, targets[k], modes[k], band) === 'hit')).length;

    const weights = days.map((d) => d.weightLb).filter((v) => typeof v === 'number');
    const delta = weights.length > 1 ? round(weights[weights.length - 1] - weights[0], 1) : null;
    const targetRate = profile?.targetGainLbPerMonth || 0;
    const supps = supplementStats(days, profile?.supplements);

    mount(stats,
      stat('Avg calories', fmtInt(avg('kcal'))),
      stat('Days logged', `${logged.length} / ${days.length}`),
      // Whole grams so three numbers still fit on one line at 390px.
      stat('Avg macros', `${fmtInt(avg('p'))} · ${fmtInt(avg('c'))} · ${fmtInt(avg('f'))}`,
           null, 'Protein · carbs · fat, in grams'),
      stat('All targets hit', `${onTarget} day${onTarget === 1 ? '' : 's'}`,
           onTarget > 0 ? 'good' : null),
      delta !== null
        ? stat('Weight change', `${delta > 0 ? '+' : ''}${delta} lb`, delta < 0 ? 'good' : delta > 0 ? 'bad' : null)
        : null,
      weights.length ? stat('Latest weight', `${weights[weights.length - 1]} lb`) : null,

      // Actual trend vs the target rate, both in lb/month so they compare directly.
      rateStats?.actual !== null && rateStats?.actual !== undefined
        ? stat('Trend',
            `${rateStats.actual > 0 ? '+' : ''}${rateStats.actual} lb/mo`,
            targetRate ? (rateStats.onTrack ? 'good' : 'bad') : null,
            targetRate ? `Target is ${targetRate > 0 ? '+' : ''}${targetRate} lb/mo` : 'Fitted trend over this range')
        : null,
      targetRate
        ? stat('Target rate', `${targetRate > 0 ? '+' : ''}${targetRate} lb/mo`)
        : null,

      supps.perSupplement.length
        ? stat('All supplements', `${supps.allDays} day${supps.allDays === 1 ? '' : 's'}`,
               supps.allDays > 0 ? 'good' : null,
               `Days you took every one of your ${supps.perSupplement.length} supplements`)
        : null,
    );
  }

  const stat = (k, v, cls = null, hint = null) =>
    h('div', { class: 'stat', title: hint || '' },
      h('div', { class: 'k' }, k),
      h('div', { class: `v tnum${cls ? ' ' + cls : ''}` }, v));

  async function paintCharts(days, profile) {
    const c = await import('../charts.js');
    charts = c;
    c.destroyAll();

    const points = c.aggregate(days);
    const targets = profile?.targets || DEFAULT_TARGETS;
    const targetRate = profile?.targetGainLbPerMonth || 0;
    const weekly = points.length && points[0].span > 1;

    // Compute the fit first so the stat strip can show trend vs target.
    const actual = c.actualRatePerMonth(points);
    rateStats = {
      actual,
      // "On track" means within half a pound a month of the target, or already
      // past it in the direction you asked for.
      onTrack: actual === null ? false
        : Math.abs(actual - targetRate) <= 0.5
          || (targetRate > 0 && actual >= targetRate)
          || (targetRate < 0 && actual <= targetRate),
    };
    paintStats(days, profile);

    const wrap = (title, note) => {
      const canvas = h('canvas');
      return [h('div', { class: 'section-head' },
                h('h2', null, title),
                note ? h('span', { class: 'meta' }, note) : null),
              h('div', { class: 'card' }, h('div', { class: 'chart-wrap' }, canvas)),
              canvas];
    };

    const note = weekly ? `averaged per ${points[0].span} days` : null;
    const [wh, wc, wCanvas] = wrap('Weight', note);
    const [ch, cc, cCanvas] = wrap('Calories', note);
    const [mh, mc, mCanvas] = wrap('Macros', note);

    /* Supplements are counted straight off the day docs rather than off the
     * bucketed points — these are whole-day counts, so averaging them into
     * weekly buckets would only blur an exact number. */
    const supps = supplementStats(days, profile?.supplements);
    let sCanvas = null;
    const suppSection = [];
    if (supps.perSupplement.length) {
      const [sh, sc, canvas] = wrap('Supplements', `out of ${supps.totalDays} days`);
      // One row per supplement plus the "All of them" row, so this card grows
      // with the list rather than using the fixed chart height.
      sc.querySelector('.chart-wrap').style.height =
        `${Math.max(120, (supps.perSupplement.length + 1) * 34 + 46)}px`;
      suppSection.push(sh, sc);
      sCanvas = canvas;
    }

    mount(body, wh, wc, ch, cc, mh, mc, ...suppSection);

    await c.weightChart(wCanvas, points, targetRate);
    await c.caloriesChart(cCanvas, points, targets.kcal);
    await c.macroChart(mCanvas, points, targets);
    if (sCanvas) await c.supplementChart(sCanvas, supps);
  }

  // Any change to the current day invalidates the cached ranges it appears in.
  subs.push(subscribe(['today'], () => { cache.clear(); }));
  subs.push(subscribe(['profile'], () => load()));

  if (getState().ready) load();
  else subs.push(subscribe(['ready'], () => load()));

  return {
    destroy() {
      subs.forEach((u) => u()); subs = [];
      charts?.destroyAll();
      getState().range = range;
    },
  };
}

/** Turn a sparse list of day docs into a dense one so the x-axis is real time. */
function fillGaps(days, range, endKey) {
  if (!days.length) return days;
  const byKey = new Map(days.map((d) => [d.date, d]));
  const start = range === 0 ? days[0].date : addDays(endKey, -(range - 1));
  const out = [];
  for (let k = start; k <= endKey; k = addDays(k, 1)) {
    out.push(byKey.get(k) || { date: k, weightLb: null, entries: [], totals: { p: 0, c: 0, f: 0, kcal: 0 } });
    if (out.length > 4000) break;      // paranoia rail
  }
  return out;
}
