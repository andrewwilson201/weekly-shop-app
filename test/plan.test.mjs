import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stapleStatus, buildShop, weekId, awayWeek, awayOn } from '../js/plan.js';

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
