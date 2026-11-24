import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordersToCount, orderItems, stapleBuys, boughtRecently, stapleStatus, learnStaple } from '../js/plan.js';

const now = new Date('2026-11-24T08:00:00Z');
const raw = [
  { order_uid: '111', status: 'previous', total: 52.1, slot_start_time: '2026-11-20T17:00:00Z' },
  { order_uid: '222', status: 'cancelled', total: 30, slot_start_time: '2026-11-21T17:00:00Z' },
  { order_uid: '333', status: 'placed', total: 80, slot_start_time: '2026-11-25T09:00:00Z' },
  { order_uid: '444', status: 'placed', total: 80, slot_start_time: '2026-12-23T09:00:00Z' },
  { order_uid: '555', status: 'previous', total: 99, slot_start_time: '2026-11-13T09:00:00Z' },
];

test('orders to count: not cancelled, before the shop, not counted yet', () => {
  const got = ordersToCount(raw, { counted: ['555'], day: '2026-11-26', now });
  assert.deepEqual(got.map(o => o.orderNumber), ['111', '333']);
  assert.equal(got[0].date, '2026-11-20');
  assert.equal(got[0].arrived, true);
  assert.equal(got[1].arrived, false);
  // The order this shop goes into is skipped; a far-off order (23 Dec) never counts.
  assert.deepEqual(ordersToCount(raw, { counted: ['555'], day: '2026-11-26', skip: '333', now }).map(o => o.orderNumber), ['111']);
});

test('order items from the order detail', () => {
  const items = orderItems({ order_items: [
    { quantity: 2, uom: 'ea', product: { product_uid: '1208450', name: 'Milk' } },
    { quantity: 0.6, uom: 'kg', product: { product_uid: '7', name: 'Bananas loose' } },
    { quantity: 1 },
  ] });
  assert.deepEqual(items, [{ uid: '1208450', name: 'Milk', qty: 2 }, { uid: '7', name: 'Bananas loose', qty: 1 }]);
});

test('staple buys only count what is newer than the app knows', () => {
  const staples = [
    { id: '1208450', product_uid: '1208450', last_bought: '2026-11-14' },
    { id: '99', product_uid: '99', last_bought: '2026-11-22' },   // bought since, through the app
    { id: '5', product_uid: '5' },                                // never bought
  ];
  const items = [{ uid: '1208450', qty: 2 }, { uid: '99', qty: 1 }, { uid: '5', qty: 1 }, { uid: 'x', qty: 1 }];
  assert.deepEqual(stapleBuys(staples, items, '2026-11-20').map(b => [b.s.id, b.qty]), [['1208450', 2], ['5', 1]]);
});

test('a staple bought outside the app is not due until the usual time, even every week', () => {
  const milk = { rule: 'every_week', every_days: 6, last_bought: '2026-11-14' };
  const after = { ...milk, ...learnStaple(milk, '2026-11-23'), outside: { date: '2026-11-23', orderNumber: '1' } };
  assert.equal(stapleStatus(after, '2026-11-25'), 'not_due');   // 2 + 3 < 6
  assert.equal(stapleStatus(after, '2026-11-26'), 'add');       // 3 + 3 >= 6
  // Once the app buys it again, the outside note no longer applies.
  assert.equal(stapleStatus({ ...after, last_bought: '2026-11-24' }, '2026-11-25'), 'add');
  const jam = { rule: 'when_due', every_days: 21, last_bought: '2026-10-20' };
  assert.equal(stapleStatus(jam, '2026-11-25'), 'add');
  assert.equal(stapleStatus({ ...jam, ...learnStaple(jam, '2026-11-20'), outside: { date: '2026-11-20' } }, '2026-11-25'), 'not_due');
  assert.equal(boughtRecently({ every_days: 7 }, '2026-11-30', '2026-11-25'), false); // not yet arrived by then
});
