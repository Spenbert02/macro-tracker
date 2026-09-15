import { normalizeBarcode, barcodeVariants, fetchProduct, toFood, isPlausibleBarcode } from '../js/off.js';
import { plausibility } from '../js/macros.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${n}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
};
const ok_ = (n, cond, info='') => { cond ? pass++ : (fail++, console.log(`FAIL ${n} ${info}`)); };

eq('UPC-A zero-pads',     normalizeBarcode('722252100900'), '0722252100900');
eq('EAN-13 untouched',    normalizeBarcode('0722252100900'), '0722252100900');
eq('EAN-8 untouched',     normalizeBarcode('96385074'), '96385074');
eq('strips junk',         normalizeBarcode(' 0722-252-100900 '), '0722252100900');
eq('empty',               normalizeBarcode(''), '');
eq('variants of UPC-A',   barcodeVariants('722252100900'), ['722252100900','0722252100900']);
eq('variants of GTIN-13', barcodeVariants('0722252100900'), ['0722252100900','722252100900']);
eq('plausible 13',        isPlausibleBarcode('0722252100900'), true);
eq('implausible 5',       isPlausibleBarcode('12345'), false);

console.log('\n--- live Open Food Facts ---');

// Clif Bar: the product whose energy_100g is 1710.29 kJ.
const clif = await fetchProduct('722252100900');
ok_('clif found', !!clif, '(network?)');
if (clif) {
  const f = toFood(clif);
  console.log(`  ${f.name} / ${f.brand} / serving "${f.servingLabel}"`);
  console.log(`  per serving: ${JSON.stringify(f.per)}`);
  console.log(`  per 100g:    ${JSON.stringify(f.per100g)}`);
  console.log(`  raw energy_100g = ${clif.nutriments.energy_100g} ${clif.nutriments.energy_unit}`);
  ok_('kcal is ~250 not ~1160', f.per.kcal > 180 && f.per.kcal < 330, `got ${f.per.kcal}`);
  ok_('per100g kcal sane',      f.per100g.kcal > 280 && f.per100g.kcal < 460, `got ${f.per100g?.kcal}`);
  eq ('plausibility ok',        plausibility(f.per), 'ok');
  ok_('has image',              !!f.imageUrl);
  eq ('id shape',               f.id, 'off_0722252100900');
}

// Diet Coke: serving_quantity is in mL, so servingGrams must not claim grams.
const coke = await fetchProduct('049000028911');
if (coke) {
  const f = toFood(coke);
  console.log(`\n  ${f.name} / serving "${f.servingLabel}" / servingGrams=${f.servingGrams}`);
  ok_('mL serving not called grams', f.servingGrams === null || f.servingLabel === '100 g', `got ${f.servingGrams}`);
  ok_('zero-cal drink kcal small', (f.per.kcal ?? 0) < 20, `got ${f.per.kcal}`);
}

// Not found -> null, not a throw.
const missing = await fetchProduct('9999999999998');
eq('not found returns null', missing, null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
