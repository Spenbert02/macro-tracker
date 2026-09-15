/* charts.js — Chart.js wrappers.
 *
 * A category x-axis with pre-formatted date strings, deliberately not the time
 * scale: the time scale needs chartjs-adapter-date-fns plus date-fns, two more
 * CDN dependencies and two more service-worker cache entries, to solve a
 * problem we don't have — our points are already one per day and evenly spaced.
 */

import { tickLabel } from './dates.js';
import { round } from './macros.js';

let Chart = null;
const instances = new Set();

async function ensureChart() {
  if (!Chart) {
    const mod = await import('https://cdn.jsdelivr.net/npm/chart.js@4.5.1/auto/+esm');
    Chart = mod.default || mod.Chart;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.animation.duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320;
  }
  return Chart;
}

const cssVar = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const theme = () => ({
  text:  cssVar('--text-dim', '#9aa4b2'),
  faint: cssVar('--text-faint', '#6b7382'),
  grid:  cssVar('--line-soft', '#1d222b'),
  surface: cssVar('--bg-raise', '#171a21'),
  p: cssVar('--p-color', '#22c55e'),
  c: cssVar('--c-color', '#3884ff'),
  f: cssVar('--f-color', '#f5a524'),
  accent: cssVar('--accent', '#3884ff'),
  good: cssVar('--good', '#22c55e'),
});

function baseOptions(t, { yTitle = '', beginAtZero = true } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 6, right: 4, bottom: 0, left: 0 } },
    plugins: {
      legend: {
        display: false,
        labels: { color: t.text, boxWidth: 10, boxHeight: 10, usePointStyle: true },
      },
      tooltip: {
        backgroundColor: t.surface,
        titleColor: t.text,
        bodyColor: t.text,
        borderColor: t.grid,
        borderWidth: 1,
        padding: 10,
        displayColors: true,
        boxWidth: 8, boxHeight: 8, usePointStyle: true,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: t.grid },
        ticks: { color: t.faint, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 10 } },
      },
      y: {
        beginAtZero,
        title: yTitle ? { display: true, text: yTitle, color: t.faint, font: { size: 10 } } : undefined,
        grid: { color: t.grid },
        border: { display: false },
        ticks: { color: t.faint, maxTicksLimit: 5, font: { size: 10 } },
      },
    },
  };
}

function make(canvas, config) {
  const c = new Chart(canvas, config);
  instances.add(c);
  return c;
}

/** A flat dashed line at `value` — a target marker without needing a plugin. */
const targetLine = (label, value, n, color) => ({
  label,
  data: new Array(n).fill(value),
  borderColor: color,
  borderDash: [6, 4],
  borderWidth: 1.5,
  pointRadius: 0,
  pointHitRadius: 0,
  fill: false,
  tension: 0,
  order: 99,
});

/**
 * Bucket days into weekly means. 365 points is unreadable on a 390px screen and
 * slow to draw; a year of weekly means is 52 points and actually says something.
 */
export function aggregate(days, maxPoints = 70) {
  if (days.length <= maxPoints) {
    return days.map((d) => ({ key: d.date, label: tickLabel(d.date), day: d }));
  }
  const size = Math.ceil(days.length / maxPoints);
  const out = [];
  for (let i = 0; i < days.length; i += size) {
    const chunk = days.slice(i, i + size);
    const mean = (pick) => {
      const vals = chunk.map(pick).filter((v) => typeof v === 'number' && Number.isFinite(v));
      return vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 1) : null;
    };
    // A day with no entries is a real zero for macros, but a missing weigh-in
    // is not a zero pound reading — so weight averages only over days present.
    const logged = chunk.filter((d) => (d.entries || []).length);
    const meanLogged = (pick) => {
      const vals = logged.map(pick).filter((v) => typeof v === 'number' && Number.isFinite(v));
      return vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 1) : null;
    };
    out.push({
      key: chunk[0].date,
      label: tickLabel(chunk[0].date),
      day: {
        date: chunk[0].date,
        weightLb: mean((d) => d.weightLb),
        totals: {
          p:    meanLogged((d) => d.totals?.p),
          c:    meanLogged((d) => d.totals?.c),
          f:    meanLogged((d) => d.totals?.f),
          kcal: meanLogged((d) => d.totals?.kcal),
        },
        entries: logged.length ? [1] : [],
      },
      span: chunk.length,
    });
  }
  return out;
}

/**
 * Trailing mean over the last `window` ACTUAL readings, not the last `window`
 * calendar slots. Weigh-ins are sparse — averaging over positions means a
 * 7-slot window containing one reading yields nothing, and the trend line never
 * draws at all. Windowing over readings gives a value on every day you stepped
 * on the scale, which `spanGaps: true` then joins into a continuous line.
 */
export function movingAverage(values, window = 7) {
  const out = new Array(values.length).fill(null);
  const seen = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    seen.push(v);
    if (seen.length > window) seen.shift();
    out[i] = round(seen.reduce((a, b) => a + b, 0) / seen.length, 1);
  }
  return out;
}

/** Mean days per plotted point — 1 normally, 7-ish once buckets kick in. */
export const daysPerPoint = (points) => points?.[0]?.span || 1;

export const DAYS_PER_MONTH = 30.4375;   // 365.25 / 12

/**
 * Least-squares fit over whatever readings exist, ignoring gaps.
 * x is the point index, so `slope` is per POINT, not per day.
 * Returns null when there is nothing to fit.
 */
export function linearFit(values) {
  const pts = [];
  values.forEach((v, i) => { if (typeof v === 'number' && Number.isFinite(v)) pts.push([i, v]); });
  if (!pts.length) return null;
  if (pts.length === 1) return { slope: 0, intercept: pts[0][1], n: 1 };
  const n = pts.length;
  const sx  = pts.reduce((a, [x]) => a + x, 0);
  const sy  = pts.reduce((a, [, y]) => a + y, 0);
  const sxx = pts.reduce((a, [x]) => a + x * x, 0);
  const sxy = pts.reduce((a, [x, y]) => a + x * y, 0);
  const den = n * sxx - sx * sx;
  if (!den) return { slope: 0, intercept: sy / n, n };
  const slope = (n * sxy - sx * sy) / den;
  return { slope, intercept: (sy - slope * sx) / n, n };
}

/** The fitted trend expressed the way the target is: pounds per month. */
export function actualRatePerMonth(points) {
  const fit = linearFit(points.map((p) => p.day.weightLb));
  if (!fit || fit.n < 2) return null;
  return round((fit.slope / daysPerPoint(points)) * DAYS_PER_MONTH, 2);
}

/* ---------------- the three charts ---------------- */

export async function weightChart(canvas, points, targetRatePerMonth = 0) {
  await ensureChart();
  const t = theme();
  const labels = points.map((p) => p.label);
  const raw = points.map((p) => (typeof p.day.weightLb === 'number' ? p.day.weightLb : null));
  const avg = movingAverage(raw, 7);

  /* Target projection: start from the FITTED weight at the beginning of the
   * period rather than the first raw reading, so one heavy morning doesn't
   * shift the whole goal line. */
  let target = null;
  const fit = linearFit(raw);
  if (targetRatePerMonth && fit) {
    const perPoint = (targetRatePerMonth / DAYS_PER_MONTH) * daysPerPoint(points);
    target = raw.map((_, i) => round(fit.intercept + i * perPoint, 2));
  }

  const present = [...raw.filter((v) => v !== null), ...(target || [])];
  const pad = present.length ? Math.max(1, (Math.max(...present) - Math.min(...present)) * 0.15) : 1;

  return make(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Trend', data: avg, borderColor: t.accent, borderWidth: 2.5, pointRadius: 0,
          tension: 0.32, spanGaps: true, fill: false, order: 1 },
        { label: 'Weight', data: raw, borderColor: t.faint, backgroundColor: t.faint, borderWidth: 0,
          pointRadius: 2.5, pointHoverRadius: 5, showLine: false, spanGaps: false, order: 2 },
        ...(target ? [{
          label: `Target (${targetRatePerMonth > 0 ? '+' : ''}${targetRatePerMonth} lb/mo)`,
          data: target,
          borderColor: t.good,
          borderDash: [6, 4],
          borderWidth: 1.8,
          pointRadius: 0,
          pointHitRadius: 0,
          fill: false,
          tension: 0,
          order: 3,
        }] : []),
      ],
    },
    options: {
      ...baseOptions(t, { yTitle: 'lb', beginAtZero: false }),
      scales: {
        ...baseOptions(t, { beginAtZero: false }).scales,
        y: {
          ...baseOptions(t, { beginAtZero: false }).scales.y,
          suggestedMin: present.length ? Math.min(...present) - pad : undefined,
          suggestedMax: present.length ? Math.max(...present) + pad : undefined,
          ticks: { color: t.faint, maxTicksLimit: 5, font: { size: 10 }, callback: (v) => `${v}` },
        },
      },
      plugins: {
        ...baseOptions(t).plugins,
        legend: { ...baseOptions(t).plugins.legend, display: true },
      },
    },
  });
}

export async function caloriesChart(canvas, points, target) {
  await ensureChart();
  const t = theme();
  const labels = points.map((p) => p.label);
  const data = points.map((p) => (p.day.entries?.length ? p.day.totals?.kcal ?? 0 : null));

  const datasets = [{
    label: 'Calories',
    data,
    backgroundColor: t.accent,
    borderRadius: 3,
    borderSkipped: false,
    maxBarThickness: 26,
    order: 2,
  }];
  if (target > 0) datasets.push({ ...targetLine('Target', target, labels.length, t.faint), type: 'line' });

  return make(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      ...baseOptions(t, { yTitle: 'kcal' }),
      plugins: { ...baseOptions(t).plugins, legend: { ...baseOptions(t).plugins.legend, display: true } },
    },
  });
}

export async function macroChart(canvas, points, targets) {
  await ensureChart();
  const t = theme();
  const labels = points.map((p) => p.label);
  const series = (key, color, label) => ({
    label,
    data: points.map((p) => (p.day.entries?.length ? p.day.totals?.[key] ?? 0 : null)),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: points.length > 45 ? 0 : 2,
    pointHoverRadius: 5,
    tension: 0.25,
    spanGaps: false,     // gaps show where you stopped logging
    fill: false,
  });

  const datasets = [
    series('p', t.p, 'Protein'),
    series('c', t.c, 'Carbs'),
    series('f', t.f, 'Fat'),
  ];
  for (const [k, color] of [['p', t.p], ['c', t.c], ['f', t.f]]) {
    if (targets?.[k] > 0) datasets.push(targetLine('', targets[k], labels.length, color + '66'));
  }

  return make(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...baseOptions(t, { yTitle: 'g' }),
      plugins: {
        ...baseOptions(t).plugins,
        legend: {
          ...baseOptions(t).plugins.legend,
          display: true,
          labels: { color: t.text, boxWidth: 10, boxHeight: 10, usePointStyle: true,
            filter: (item) => !!item.text },     // hide the unlabelled target lines
        },
      },
    },
  });
}

/** Chart.js instances hold canvases and listeners; leaking them makes the app crawl. */
export function destroyAll() {
  for (const c of instances) { try { c.destroy(); } catch {} }
  instances.clear();
}
