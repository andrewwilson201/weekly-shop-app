import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stapleStatus, buildShop, weekId, awayWeek, awayOn, matchUsual, recordBought, parseMultibuy, eachPrice, onOffer, packSize, unitCost, searchTerms, cheapestSwap, toCook } from '../js/plan.js';

test('staple due rule matches build-staples.py', () => {
  assert.equal(stapleStatus({ rule: 'every_week' }, '2026-11-10'), 'add');
  assert.equal(stapleStatus({ rule: 'when_due', every_days: 14, last_bought: '2026-11-01' }, '2026-11-12'), 'add');     // 11 + 3 >= 14
  assert.equal(stapleStatus({ rule: 'when_due', every_days: 14, last_bought: '2026-11-01' }, '2026-11-10'), 'not_due');
  assert.equal(stapleStatus({ rule: 'when_due', every_days: 7, last_bought: '2026-09-01' }, '2026-11-10'), 'lapsed');
  assert.equal(stapleStatus({ rule: 'suggest', every_days: 7, last_bought: '2026-11-01' }, '2026-11-10'), 'suggest');
  assert.equal(stapleStatus({ rule: 'every_week', dropped: true }, '2026-11-10'), 'dropped');
});

test('weeks are named after the day they start', () => {
  assert.equal(weekId(new Date('2026-11-06T12:00:00Z')), '2026-11-01');
  assert.equal(weekId(new Date('2026-11-08T12:00:00Z')), '2026-11-08');
});

test('shop merges meals, skips cupboard items unless ticked', () => {
  const meals = [
    { id: 'a', name: 'A', ingredients: [{ item: 'Chopped tomatoes', search: 'tomatoes', qty: 2 }, { item: 'Olive oil', pantry: true }] },
    { id: 'b', name: 'B', ingredients: [{ item: 'Chopped tomatoes', search: 'tomatoes', qty: 1 }] },
  ];
  let lines = buildShop({ meals, delivery: '2026-11-10' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty, 3);
  lines = buildShop({ meals, delivery: '2026-11-10', extras: { 'meal:a:Olive oil': true } });
  assert.equal(lines.length, 2);
});

test('skipped staples are pushed back, then become suggestions', () => {
  const weekly = { rule: 'every_week', last_bought: '2026-11-03', skips: 1, skipped_on: '2026-11-10' };
  assert.equal(stapleStatus(weekly, '2026-11-12'), 'not_due');   // skipped this week
  assert.equal(stapleStatus(weekly, '2026-11-17'), 'add');       // back next week
  assert.equal(stapleStatus({ ...weekly, skips: 3 }, '2026-11-17'), 'suggest');
  const slow = { rule: 'when_due', every_days: 14, last_bought: '2026-10-27', skips: 1, skipped_on: '2026-11-10' };
  assert.equal(stapleStatus(slow, '2026-11-17'), 'not_due');     // counts from the skip, not the purchase
  assert.equal(stapleStatus(slow, '2026-11-21'), 'add');
});

test('holiday mode', () => {
  const away = [{ from: '2026-12-20', to: '2026-12-29' }];
  assert.ok(awayOn(away, '2026-12-25'));
  assert.equal(awayOn(away, '2026-12-30'), null);
  assert.equal(awayWeek(away, '2026-12-20'), true);   // Sun 20 – Sat 26: all away
  assert.equal(awayWeek(away, '2026-12-13'), false);  // only Sat 19? none
  assert.equal(awayWeek(away, '2026-12-27'), false);  // 27, 28, 29 = 3 days
});

test('Claude ideas: no more than 2 of one protein, vegetarian 3', async () => {
  const { validate } = await import('../worker/ideas-claude.mjs');
  const byId = new Map(['a', 'b', 'c', 'd', 'e', 'f'].map(id => [id, { id, name: id }]));
  const ideas = [
    { existing_id: 'a', protein: 'chicken' }, { existing_id: 'b', protein: 'chicken' }, { existing_id: 'c', protein: 'chicken' },
    { existing_id: 'd', protein: 'vegan' }, { existing_id: 'e', protein: 'vegetarian' }, { existing_id: 'f', protein: 'vegetarian' },
    { existing_id: '', name: 'Veg chilli', protein: 'vegetarian', ingredients: [{ item: 'Beans', qty: 1 }] },
    { existing_id: '', name: 'A', protein: 'chicken', ingredients: [{ item: 'x', qty: 1 }] },
  ];
  const out = validate(ideas, byId);
  assert.deepEqual(out.map(o => o.id || o.meal.name), ['a', 'b', 'd', 'e', 'f']);
});

test('staples re-learn how often they are bought and log each purchase', async () => {
  const { learnStaple } = await import('../js/plan.js');
  const s = { rule: 'when_due', every_days: 14, last_bought: '2026-10-01', times_bought: 5 };
  const u = learnStaple(s, '2026-11-05', 2); // 35 days later: bought less often now
  assert.equal(u.every_days, Math.round(0.7 * 14 + 0.3 * 35));
  assert.equal(u.times_bought, 6);
  assert.deepEqual(u.history, [{ date: '2026-11-05', qty: 2 }]);
  assert.match(u.freqNote, /every 20 days/);
  const weekly = learnStaple({ rule: 'every_week', every_days: 7, last_bought: '2026-10-01' }, '2026-11-05');
  assert.equal(weekly.every_days, undefined);
});

test('matchUsual finds the usual product from past orders', () => {
  const P = [
    { u: '1', n: 'Aussie Miracle Moist Shampoo 300ml', c: 4, l: '2024-05-20' },
    { u: '2', n: 'Head & Shoulders Classic Clean Anti-Dandruff Shampoo 400ml', c: 2, l: '2026-07-02' },
    { u: '3', n: 'Radox 2 in 1 Shower Gel & Shampoo', c: 1, l: '2026-09-01' },
    { u: '4', n: 'Baylis & Harding Rose Natural Body Wash 500ml', c: 11, l: '2026-08-25' },
    { u: '5', n: "Sainsbury's Fairtrade Bananas x8", c: 46, l: '2026-09-24' },
    { u: '6', n: 'Andrex Complete Clean Toilet Rolls x9', c: 39, l: '2026-09-24' },
  ];
  // Bought twice or more beats a one-off, then the most recent wins.
  assert.deepEqual(matchUsual('shampoo', P).map(p => p.u), ['2', '1', '3']);
  assert.equal(matchUsual('Shower gel', P)[0].u, '4'); // other names for the same thing
  assert.equal(matchUsual('banana', P)[0].u, '5');     // plurals
  assert.equal(matchUsual('bananas', P)[0].u, '5');
  assert.equal(matchUsual('loo roll', P)[0].u, '6');
  assert.deepEqual(matchUsual('ketchup', P), []);
  assert.deepEqual(matchUsual('shampoo', []), []);
});

test('recordBought counts a purchase and adds new products', () => {
  let P = [{ u: '1', n: 'Old name', c: 2, l: '2026-01-01' }];
  P = recordBought(P, 1, 'New name', '2026-11-10');
  assert.deepEqual(P, [{ u: '1', n: 'New name', c: 3, l: '2026-11-10' }]);
  P = recordBought(P, '9', 'Shampoo', '2026-11-10');
  assert.equal(P.length, 2);
  assert.deepEqual(P[1], { u: '9', n: 'Shampoo', c: 1, l: '2026-11-10' });
});

// Prices as Sainsbury's search returned them on 2026-11-07 (store 0031).
const P = {
  mild: { uid: '7178847', name: "Sainsbury's British Mild Cheddar Cheese 400g", price: 3.2, unit: 8, measure: 'kg', offer: '' },
  cathedral: { uid: '7511803', name: 'Cathedral City Mild Cheddar Cheese 350g', price: 2.8, unit: 8, was: 10.71, measure: 'kg', offer: 'Save 25% with Nectar' },
  stamford600: { uid: '7646860', name: 'Stamford Street Co. Mild Cheddar 600g', price: 3.67, unit: 6.12, measure: 'kg', offer: '' },
  napolina: { uid: '2274379', name: 'Napolina Chopped Tomatoes 400g', price: 1.05, unit: 2.63, measure: 'kg', offer: '' },
  sainsTom: { uid: '6365335', name: "Sainsbury's Chopped Tomatoes Can 400g", price: 0.45, unit: 1.13, measure: 'kg', offer: '' },
  cirio4: { uid: '8265466', name: 'Cirio 4 x 400g Finely Chopped Tomatoes', price: 2.5, unit: 1.57, was: 3.13, measure: 'kg', offer: 'Half Price with Nectar' },
  cirio1: { uid: 'x-cirio-400', name: 'Cirio Finely Chopped Tomatoes 400g', price: 0.75, unit: 1.88, was: 2.5, measure: 'kg', offer: 'Save 25% with Nectar' },
  chicken320: { uid: '7977681', name: "Sainsbury's 320g British Fresh Skinless & Boneless Chicken Breast Fillets", price: 2.44, unit: 7.63, measure: 'kg', offer: 'Buy 2 for £4.00 with Nectar' },
  chicken640: { uid: '7874927', name: "Sainsbury's 640g British Fresh Skinless & Boneless Chicken Breast Fillets", price: 4.62, unit: 7.22, measure: 'kg', offer: 'Buy 2 for £8.00 with Nectar' },
  bananas8: { uid: '7553276', name: "Sainsbury's Fairtrade Bananas x8", price: 1.39, unit: 0.17, measure: 'ea', offer: '' },
  bananasLoose: { uid: '1196757', name: "Sainsbury's Bananas Loose", price: 0.9, unit: 0.9, measure: 'kg', offer: '' },
};

test('multibuys are read from the offer text', () => {
  assert.deepEqual(parseMultibuy('Buy 2 for £4.00 with Nectar'), { n: 2, total: 4 });
  assert.deepEqual(parseMultibuy('Buy any 2 for £5.00 with Nectar'), { n: 2, total: 5 });
  assert.deepEqual(parseMultibuy('3 for 2'), { n: 3, pay: 2 });
  assert.equal(parseMultibuy('Buy 1 for 3.25'), null);          // already in the price
  assert.equal(parseMultibuy('Save 25% with Nectar'), null);    // already in the price
});

test('a multibuy only counts when the line buys enough', () => {
  assert.equal(eachPrice(P.chicken320, 1), 2.44);
  assert.equal(eachPrice(P.chicken320, 2), 2);
  assert.equal(eachPrice(P.chicken320, 3), (4 + 2.44) / 3);
  assert.equal(eachPrice({ price: 1.5, offer: '3 for 2' }, 3), 1);
  assert.ok(Math.abs(packSize(P.cathedral) - 0.35) < 0.001);
  assert.ok(Math.abs(unitCost(P.chicken320, 2) - 2 / (2.44 / 7.63)) < 0.001);
});

test('search words drop the store brand, range and pack size', () => {
  assert.equal(searchTerms("Sainsbury's British Semi Skimmed Milk, SO Organic 2.27L (4 pint)"), 'British Semi Skimmed Milk');
  assert.equal(searchTerms("Sainsbury's Italian Chopped Tomatoes 4×400g"), 'Italian Chopped Tomatoes');
  assert.equal(searchTerms("Sainsbury's Free Range Golden Yolk Eggs, Taste the Difference x12"), 'Free Range Golden Yolk Eggs');
});

test('cheapest swap compares price per kg at a similar pack size', () => {
  // Only products on offer are swapped to: Sainsbury's own tin is cheaper but not on offer.
  assert.ok(onOffer(P.cathedral) && onOffer(P.chicken320, 2) && !onOffer(P.chicken320, 1) && !onOffer(P.sainsTom));
  assert.equal(cheapestSwap(P.napolina, [P.sainsTom], 2), null);
  // Napolina 400g → a 400g tin on offer; the Cirio 4-pack is on offer too but four times the size.
  const s = cheapestSwap(P.napolina, [P.cirio4, P.sainsTom, P.cirio1], 2);
  assert.equal(s.product.uid, P.cirio1.uid);
  assert.equal(s.saving, 0.6);
  // Same price per kg (Nectar price included) isn't worth swapping for.
  assert.equal(cheapestSwap(P.mild, [P.cathedral], 1), null);
  // 600g is more than 35% bigger than 400g.
  assert.equal(cheapestSwap(P.mild, [P.stamford600], 1), null);
  // Loose bananas are priced per kg, the pack per banana: not compared.
  assert.equal(cheapestSwap(P.bananas8, [P.bananasLoose], 1), null);
  // Buying two 320g packs gets the Nectar multibuy (£2 each = £6.25/kg), beating the bigger pack's £7.22/kg.
  assert.equal(cheapestSwap(P.chicken640, [P.chicken320], 1), null);    // 320g is half the size
  assert.equal(cheapestSwap(P.chicken320, [P.chicken640], 2), null);    // 640g double, and dearer per kg once the multibuy counts
  const c = cheapestSwap(P.chicken320, [P.chicken640], 1);
  assert.equal(c, null);                                                // size check rules it out either way
  // Catchweight (priced by weight at the till) is never swapped to or from.
  assert.equal(cheapestSwap({ ...P.mild, catchweight: true }, [P.cathedral], 1), null);
});

test('toCook keeps last week\'s dinners until they are cooked', () => {
  const weeks = {
    '2026-10-25': { id: '2026-10-25', picks: { old: {} } },                       // no order: nothing bought
    '2026-11-01': { id: '2026-11-01', picks: { a: {}, b: {}, x: {} }, cooked: { a: { on: '2026-11-04' } } },
    '2026-11-08': { id: '2026-11-08', picks: { c: {} }, deliveryDate: '2026-11-12' },
    '2026-10-18': { id: '2026-10-18', picks: { z: {} } },
  };
  const orders = [
    { week: '2026-11-01', state: 'placed', meals: ['a', 'b'], deliveryDate: '2026-11-05' }, // x was unpicked before ordering
    { week: '2026-10-18', state: 'cancelled' },
  ];
  const out = toCook({ weeks, orders, current: '2026-11-08' });
  assert.deepEqual(out.map(x => x.mealId), ['a', 'b', 'c']);
  assert.equal(out[0].done.on, '2026-11-04');
  assert.equal(out[1].done, null);
  assert.equal(out[1].delivery, '2026-11-05');
  assert.equal(out[1].ordered, true);
  assert.equal(out[2].ordered, false);
  // A failed order may have been finished by hand in Sainsbury's app, so its picks still count.
  const failed = toCook({ weeks: { w: { id: '2026-11-01', picks: { q: {} } } }, orders: [{ week: '2026-11-01', state: 'failed' }], current: '2026-11-08' });
  assert.deepEqual(failed.map(x => x.mealId), ['q']);
});

// ---------- added with the review fixes ----------
import { scaleLine, scaleQty, scaleFor, servesNumber, isIdea, wouldNot, iso, pickIdeas } from '../js/plan.js';

test('dates are UK dates: just after midnight in summer it is already the next day', () => {
  assert.equal(iso(new Date('2026-07-01T23:30:00Z')), '2026-07-02');
  assert.equal(iso(new Date('2026-12-01T23:30:00Z')), '2026-12-01');
  // 00:30 on the first day of a week in summer is a new week in the UK while it's still Saturday in UTC.
  assert.equal(weekId(new Date('2026-07-04T23:30:00Z')), '2026-07-05');
});

test('recipe lines scale their leading amount only', () => {
  assert.equal(scaleLine('2 x 400g tins chopped tomatoes', 2), '4 x 400g tins chopped tomatoes');
  assert.equal(scaleLine('200g flour', 4 / 6), '135g flour');
  assert.equal(scaleLine('1½ tbsp olive oil', 2), '3 tbsp olive oil');
  assert.equal(scaleLine('2-3 garlic cloves', 2), '4–6 garlic cloves');
  assert.equal(scaleLine('Salt and pepper', 2), 'Salt and pepper');
  assert.equal(scaleLine('3 eggs', 1), '3 eggs');
});

test('meals scale from what the recipe serves to what the household cooks for', () => {
  assert.equal(servesNumber('Serves 4-6'), 4);
  assert.equal(scaleFor({ servings: '6' }, 4), 4 / 6);
  assert.equal(scaleFor({ servings: '4', cookFor: 2 }, 4), 0.5);
  assert.equal(scaleFor({}, 4), 1);
  assert.equal(scaleQty(2, 4 / 6), 1);
  assert.equal(scaleQty(1, 4 / 6), 1);
  assert.equal(scaleQty(1, 2), 2);
  assert.equal(scaleQty(3, 1.1), 3); // small changes ignored
});

test('Shop screen quantities override the line quantity', () => {
  const lines = buildShop({ list: [{ id: 'a', text: 'Milk', qty: 1 }], qtys: { 'list:a': 3 } });
  assert.equal(lines[0].qty, 3);
});

test('unpicked ideas from Claude or a recipe site are not library meals', () => {
  assert.equal(isIdea({ idea: true }), true);
  assert.equal(isIdea({ idea: true, timesChosen: 1 }), false);
  assert.equal(isIdea({ idea: false }), false);
  assert.equal(isIdea({ addedBy: { name: 'Claude' } }), true); // older meals without the flag
  assert.equal(isIdea({ addedBy: { name: 'Andrew', uid: 'u1' } }), false);
  assert.equal(isIdea({ name: 'Starter meal' }), false);
});

test('a dinner they would not make again is not suggested', () => {
  const meals = [{ id: 'a', name: 'A', verdicts: [{ again: false }] }, { id: 'b', name: 'B', verdicts: [{ again: false }, { again: true }] }, { id: 'c', name: 'C' }];
  assert.equal(wouldNot(meals[0]), true);
  assert.equal(wouldNot(meals[1]), false);
  assert.deepEqual(pickIdeas(meals, { count: 10 }).sort(), ['b', 'c']);
});

test('a trial order does not count as the week being ordered', () => {
  const weeks = { '2026-11-01': { id: '2026-11-01', picks: { m1: {} } } };
  assert.equal(toCook({ weeks, orders: [{ week: '2026-11-01', state: 'trial_done', trial: true }], current: '2026-11-08' }).length, 0);
  assert.equal(toCook({ weeks, orders: [{ week: '2026-11-01', state: 'placed', meals: ['m1'] }], current: '2026-11-08' }).length, 1);
});

import { planCmp, currentPlanId, newPlanId, aisleOf, estimateShop, priceChange } from '../js/plan.js';

test('plans are ordered by start date, then by their number', () => {
  assert.deepEqual(['2026-11-11-2', '2026-11-08', '2026-11-11', '2026-11-11-10'].sort(planCmp), ['2026-11-08', '2026-11-11', '2026-11-11-2', '2026-11-11-10']);
});

test('the current plan is the newest open one, else a new one', () => {
  const today = '2026-11-11';
  assert.equal(currentPlanId({}, today), '2026-11-11', 'no plans: start today');
  // An old Sunday-week plan not yet ordered carries on.
  assert.equal(currentPlanId({ '2026-11-08': { status: undefined } }, today), '2026-11-08');
  // Ordered: a new plan starts today.
  assert.equal(currentPlanId({ '2026-11-08': { status: 'ordered' } }, today), '2026-11-11');
  // Ordered twice in one day: the second plan gets -2, then -3.
  assert.equal(currentPlanId({ '2026-11-11': { status: 'ordered' } }, today), '2026-11-11-2');
  assert.equal(currentPlanId({ '2026-11-11': { status: 'ordered' }, '2026-11-11-2': { status: 'closed' } }, today), '2026-11-11-3');
  // "Start afresh" closes a plan the same way.
  assert.equal(currentPlanId({ '2026-11-10': { status: 'closed' } }, today), '2026-11-11');
  // A plan dated later than today (a Sunday-week id) is never followed by an earlier one.
  assert.equal(newPlanId(['2026-11-15'], today), '2026-11-15-2');
});

test('basket lines are grouped by aisle', () => {
  const a = name => aisleOf({ name });
  assert.equal(a('Frozen peas'), 'frozen');
  assert.equal(a('Coconut milk'), 'cupboard');
  assert.equal(a('Butternut squash'), 'veg');
  assert.equal(a('Flour tortillas'), 'bakery');
  assert.equal(a('Tortilla chips'), 'cupboard');
  assert.equal(a('Robinsons orange squash'), 'drinks');
  assert.equal(a('Chicken thighs'), 'meat');
  assert.equal(a('Greek yoghurt'), 'dairy');
  assert.equal(a('Toilet roll'), 'household');
  assert.equal(a('Birthday candles'), 'other');
  // The product name helps when the line's own name doesn't say.
  assert.equal(aisleOf({ name: 'Beans', product: "Sainsbury's Baked Beans 4x415g" }), 'cupboard');
});

test('the basket estimate uses last prices paid', () => {
  const prices = { 1: { p: 1.5, d: '2026-11-01' }, 2: { p: 2, d: '2026-11-01' } };
  assert.deepEqual(estimateShop([{ uid: 1, qty: 2 }, { uid: 2 }, { uid: 3 }, { name: 'no uid' }], prices), { total: 5, known: 2, unknown: 2 });
  assert.deepEqual(estimateShop([], prices), { total: 0, known: 0, unknown: 0 });
});

test('price changes under 5p are ignored', () => {
  assert.equal(priceChange(1.5, 1.9), 0.4);
  assert.equal(priceChange(1.5, 1.2), -0.3);
  assert.equal(priceChange(1.5, 1.53), 0);
  assert.equal(priceChange(undefined, 2), 0);
});

test('orders booked in the Sainsbury\'s app: upcoming and changeable ones near the day', async () => {
  const { upcomingOrders, ordersNear } = await import('../js/plan.js');
  const now = new Date('2026-11-14T08:00:00Z');
  const raw = [
    { order_uid: 1, status: 'placed', total: '33.50', slot_start_time: '2026-11-20T09:00:00Z', slot_end_time: '2026-11-20T10:00:00Z' },
    { order_uid: 2, status: 'delivered', total: '180', slot_start_time: '2026-11-21T09:00:00Z' },
    { order_uid: 3, status: 'placed', slot_start_time: '2026-11-10T09:00:00Z' },
    { order_uid: 4, status: 'placed', is_amendable: false, slot_start_time: '2026-11-19T09:00:00Z' },
    { order_uid: 5, status: 'placed', total: 40, slot_start_time: '2026-12-23T09:00:00Z' },
    { order_uid: 6, status: 'cancelled', slot_start_time: '2026-11-20T12:00:00Z' },
  ];
  const up = upcomingOrders(raw, now);
  assert.deepEqual(up.map(o => o.orderNumber), ['1', '5']);
  assert.deepEqual(up[0], { orderNumber: '1', start_time: '2026-11-20T09:00:00Z', end_time: '2026-11-20T10:00:00Z', date: '2026-11-20', total: 33.5 });
  assert.deepEqual(ordersNear(up, '2026-11-19').map(o => o.orderNumber), ['1']);
  assert.deepEqual(ordersNear(up, '2026-11-17').map(o => o.orderNumber), []);
  assert.deepEqual(ordersNear(up, '2026-11-17', true).map(o => o.orderNumber), ['1'], 'a plan marked booked looks a little further');
  assert.deepEqual(upcomingOrders([{ order_uid: 7, slot_start_time: '2026-11-15T23:30:00Z' }], now)[0].date, '2026-11-15');
});
