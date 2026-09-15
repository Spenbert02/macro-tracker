import { localDayKey, addDays, daysBetween, rangeKeys, relativeDay } from '../js/dates.js';
import { sumEntries, scaleEntry, kcalFromMacros, goalStatus, plausibility, progress, round } from '../js/macros.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL  ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const ok_ = (name, cond, info = '') => {
  cond ? pass++ : (fail++, console.log(`FAIL  ${name}  ${info}`));
};

// ---- THE critical assertion: 8:30pm Central on the 15th must be the 15th, not the 16th.
eq('tz: 01:30Z Sep16 in Chicago is Sep 15', localDayKey(new Date('2026-09-16T01:30:00Z'), 'America/Chicago'), '2026-09-15');
eq('tz: same instant in UTC is Sep 16',     localDayKey(new Date('2026-09-16T01:30:00Z'), 'UTC'), '2026-09-16');
eq('tz: 05:00Z is still Sep 15 in Chicago', localDayKey(new Date('2026-09-16T04:59:00Z'), 'America/Chicago'), '2026-09-15');
eq('tz: 05:01Z flips to Sep 16',            localDayKey(new Date('2026-09-16T05:01:00Z'), 'America/Chicago'), '2026-09-16');
eq('tz: bad timezone falls back to UTC',    localDayKey(new Date('2026-09-16T01:30:00Z'), 'Not/AZone'), '2026-09-16');

// ---- day-key arithmetic must survive DST and month/year ends
eq('addDays +1',              addDays('2026-09-15', 1),  '2026-09-16');
eq('addDays -1',              addDays('2026-09-15', -1), '2026-09-14');
eq('addDays across month',    addDays('2026-09-30', 1),  '2026-10-01');
eq('addDays across year',     addDays('2026-12-31', 1),  '2027-01-01');
eq('addDays across DST fwd',  addDays('2027-03-13', 1),  '2027-03-14');
eq('addDays across DST back', addDays('2026-11-01', 1),  '2026-11-02');
eq('addDays leap day',        addDays('2028-02-28', 1),  '2028-02-29');
eq('addDays -365',            addDays('2026-09-15', -365), '2025-09-15');
eq('daysBetween',             daysBetween('2026-09-15', '2026-09-18'), 3);
eq('daysBetween negative',    daysBetween('2026-09-18', '2026-09-15'), -3);
eq('rangeKeys(3)',            rangeKeys('2026-09-15', 3), ['2026-09-13','2026-09-14','2026-09-15']);
eq('rangeKeys len 30',        rangeKeys('2026-09-15', 30).length, 30);

// ---- macro math
eq('kcalFromMacros 10/43/6',  kcalFromMacros(10, 43, 6), 266);
eq('scaleEntry x1.5',         scaleEntry({ p:10, c:43, f:6, kcal:250, servings:1.5 }), { p:15, c:64.5, f:9, kcal:375 });
eq('scaleEntry x0',           scaleEntry({ p:10, c:43, f:6, kcal:250, servings:0 }),   { p:0, c:0, f:0, kcal:0 });
eq('sumEntries empty',        sumEntries([]), { p:0, c:0, f:0, kcal:0 });
eq('sumEntries null-safe',    sumEntries(null), { p:0, c:0, f:0, kcal:0 });
eq('sumEntries two',          sumEntries([
                                { p:10, c:43, f:6, kcal:250, servings:1.5 },
                                { p:24, c:3,  f:1, kcal:120, servings:2 } ]),
                              { p:63, c:70.5, f:11, kcal:615 });
eq('sumEntries float fuzz',   sumEntries([{ p:0.1, c:0.2, f:0, kcal:0, servings:3 }]).c, 0.6);
eq('sumEntries missing field',sumEntries([{ p:10, servings:2 }]), { p:20, c:0, f:0, kcal:0 });
eq('round drops fuzz',        round(64.50000000000001, 1), 64.5);

// ---- goal rules, at every boundary
eq('min below',  goalStatus(179, 180, 'min'), 'miss');
eq('min exact',  goalStatus(180, 180, 'min'), 'hit');
eq('min above',  goalStatus(181, 180, 'min'), 'hit');
eq('max below',  goalStatus(69,  70,  'max'), 'hit');
eq('max exact',  goalStatus(70,  70,  'max'), 'hit');
eq('max above',  goalStatus(71,  70,  'max'), 'miss');
eq('band center',     goalStatus(2400, 2400, 'band', 0.05), 'hit');
eq('band low edge',   goalStatus(2280, 2400, 'band', 0.05), 'hit');   // exactly -5%
eq('band under edge', goalStatus(2279, 2400, 'band', 0.05), 'miss');
eq('band high edge',  goalStatus(2520, 2400, 'band', 0.05), 'hit');   // exactly +5%
eq('band over edge',  goalStatus(2521, 2400, 'band', 0.05), 'miss');
eq('empty day protein is a miss', goalStatus(0, 180, 'min'), 'miss');
eq('empty day fat is a hit',      goalStatus(0, 70,  'max'), 'hit');
eq('empty day kcal is a miss',    goalStatus(0, 2400,'band',0.05), 'miss');
eq('no target set is a hit',      goalStatus(0, 0, 'min'), 'hit');
eq('progress clamps high',        progress(3000, 2400), 1);
eq('progress clamps low',         progress(-5, 2400), 0);
eq('progress no target',          progress(100, 0), 0);

// ---- plausibility: the kJ trap
eq('plausible clif bar',   plausibility({ p:10, c:43, f:6, kcal:250 }), 'ok');
eq('kJ value flagged',     plausibility({ p:10, c:43, f:6, kcal:1160 }), 'kj');
eq('nonsense flagged',     plausibility({ p:10, c:43, f:6, kcal:900 }), 'suspect');
eq('all zero is silent',   plausibility({ p:0, c:0, f:0, kcal:0 }), null);
eq('missing data silent',  plausibility({ p:10, c:null, f:6, kcal:250 }), null);

// ---- weight trend fitting and the target-gain projection
const { linearFit, actualRatePerMonth, movingAverage, aggregate, DAYS_PER_MONTH } =
  await import('../js/charts.js');

const clean = Array.from({ length: 31 }, (_, i) => 180 - i * (2 / DAYS_PER_MONTH));
const fit = clean.length ? linearFit(clean) : null;
ok_('fit: intercept is the starting weight', Math.abs(fit.intercept - 180) < 1e-9, fit.intercept);
ok_('fit: recovers -2 lb/month exactly',     Math.abs(fit.slope * DAYS_PER_MONTH + 2) < 1e-9);
eq ('fit: no readings at all',               linearFit([null, null]), null);
eq ('fit: a single reading has zero slope',  linearFit([null, 183, null]), { slope: 0, intercept: 183, n: 1 });

const sparse = clean.map((w, i) => ({ day: { weightLb: i % 3 ? null : w } }));
ok_('rate: survives weighing every third day', Math.abs(actualRatePerMonth(sparse) + 2) < 0.02, actualRatePerMonth(sparse));
eq ('rate: null when nothing to fit',          actualRatePerMonth([{ day: { weightLb: null } }]), null);

// an outlier at the start must not drag the projection's origin with it
const spiked = [188, ...clean.slice(1)];
ok_('fit: one heavy morning barely moves the intercept',
    Math.abs(linearFit(spiked).intercept - 180) < 1.2, linearFit(spiked).intercept);

// the trend line has to survive sparse weigh-ins (it previously came out empty)
const ma = movingAverage([183, null, null, 182.8, null, null, 182.6], 7);
ok_('trend: a value on every day with a reading',
    ma[0] === 183 && ma[3] !== null && ma[6] !== null && ma[1] === null);

// long ranges bucket down to something drawable
const many = Array.from({ length: 365 }, (_, i) => ({
  date: `2026-${String(Math.floor(i / 31) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
  weightLb: 180, entries: [1], totals: { p: 1, c: 1, f: 1, kcal: 1 } }));
const bucketed = aggregate(many, 70);
ok_('aggregate: a year collapses to <= 70 points', bucketed.length <= 70, bucketed.length);
ok_('aggregate: buckets report their span',        bucketed[0].span > 1);
eq ('aggregate: short ranges are left alone',      aggregate(many.slice(0, 30), 70).length, 30);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
