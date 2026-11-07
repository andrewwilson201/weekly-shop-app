import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stapleStatus, buildShop, weekId, awayWeek, awayOn, matchUsual, recordBought } from '../js/plan.js';

test('staple due rule matches build-staples.py', () => {
  assert.equal(stapleStatus({ rule: 'every_week' }, '2026-11-10'), 'add');
  assert.equal(stapleStatus({ rule: 'when_due', every_days: 14, last_bought: '2026-11-01' }, '2026-11-12'), 'add');     // 11 + 3 >= 14
  assert.equal(stapleStatus({ rule: 'when_due', every_days: 14, last_bought: '2026-11-01' }, '2026-11-10'), 'not_due');
  assert.equal(stapleStatus({ rule: 'when_due', every_days: 7, last_bought: '2026-09-01' }, '2026-11-10'), 'lapsed');
  assert.equal(stapleStatus({ rule: 'suggest', every_days: 7, last_bought: '2026-11-01' }, '2026-11-10'), 'suggest');
  assert.equal(stapleStatus({ rule: 'every_week', dropped: true }, '2026-11-10'), 'dropped');
});

test('weeks are named after their Sunday', () => {
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
