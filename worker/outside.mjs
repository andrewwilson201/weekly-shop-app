// Orders placed outside the app (straight in the Sainsbury's app or website,
// or things added to an order there): count what they bought, so staples
// bought there aren't due again and "your usual" knows about them. Runs at the
// start of each order run, using its login, and for Settings › "Check
// Sainsbury's for other orders". Only reads from Sainsbury's.
//
// households/{hid}/meta/outside  { counted: [order numbers done with],
//   orders: [{ orderNumber, date, total, items, staples }] (outside ones found),
//   checkedAt }
import { FieldValue } from 'firebase-admin/firestore';
import { ordersToCount, orderItems, stapleBuys, learnStaple, recordBought } from '../js/plan.js';

// day: count orders arriving before this day (the shop's delivery day).
// skip: the Sainsbury's order this shop is going into, if any.
// Returns { caught: Map(stapleId -> { date, orderNumber, staple }), found: [outside orders counted this time] }.
export async function countOutside(h, shop, { day, skip = '', log = async () => {} } = {}) {
  const caught = new Map(), found = [];
  const metaRef = h.ref.collection('meta').doc('outside');
  const meta = (await metaRef.get()).data() || {};
  let todo;
  try { todo = ordersToCount(await shop.orders(), { counted: meta.counted || [], day, skip }); }
  catch (e) { await log(`Couldn't read your Sainsbury's orders (${e.status || e.message}), so ones placed outside the app weren't checked`); return { caught, found }; }
  const counted = [...(meta.counted || [])].map(String);
  if (!todo.length) {
    await metaRef.set({ checkedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { caught, found };
  }
  const staples = (await h.ref.collection('staples').get()).docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  // Orders the app placed (or was told were finished in the Sainsbury's app):
  // their staples are already counted, but anything added to them in the
  // Sainsbury's app isn't, so they're read too, just not called "outside".
  const mine = (await h.ref.collection('orders').where('state', '==', 'placed').get()).docs.map(d => d.data()).filter(o => !o.trial);
  const myNumbers = new Set(mine.map(o => String(o.orderNumber || o.addTo?.orderNumber || '')).filter(Boolean));
  const mySlots = new Set(mine.map(o => String(o.slot?.start_time || '').slice(0, 16)).filter(Boolean));
  const pref = h.ref.collection('meta').doc('products');
  let products = (await pref.get()).data()?.items || [];
  const known = new Map((meta.orders || []).map(o => [o.orderNumber, o]));
  for (const o of todo) {
    let items;
    try { items = orderItems(await shop.order(o.orderNumber)); }
    catch (e) { await log(`Couldn't read what was in a Sainsbury's order (${e.status || e.message})`); continue; }
    if (!items.length) continue;
    const fromApp = myNumbers.has(o.orderNumber) || mySlots.has(o.start_time.slice(0, 16));
    const buys = stapleBuys(staples, items, o.date);
    const b = h.ref.firestore.batch();
    for (const { s, qty } of buys) {
      const update = learnStaple(s, o.date, qty);
      if (!fromApp) update.outside = { date: o.date, orderNumber: o.orderNumber };
      b.set(s.ref, { ...update, skipped_on: FieldValue.delete() }, { merge: true });
      Object.assign(s, update); delete s.skipped_on;
      caught.set(s.id, { date: o.date, orderNumber: o.orderNumber, fromApp, staple: s });
    }
    if (!fromApp) {
      const seen = new Set();
      for (const i of items) if (!seen.has(i.uid)) { seen.add(i.uid); products = recordBought(products, i.uid, i.name, o.date); }
      const row = { orderNumber: o.orderNumber, date: o.date, total: o.total, items: items.length, staples: buys.length };
      known.set(o.orderNumber, row);
      found.push(row);
    }
    await b.commit();
    if (o.arrived) counted.push(o.orderNumber);
    if (buys.length || !fromApp) await log(fromApp
      ? `${buys.length} staple${buys.length === 1 ? '' : 's'} added in the Sainsbury's app to the order for ${o.date} counted`
      : `Found an order placed outside the app for ${o.date}: ${buys.length} staple${buys.length === 1 ? '' : 's'} in it counted as bought`);
  }
  if (found.length) await pref.set({ items: products }, { merge: true });
  const orders = [...known.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-20);
  await metaRef.set({ counted: [...new Set(counted)].slice(-80), orders, checkedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { caught, found };
}
