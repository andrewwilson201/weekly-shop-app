// Order worker. Looks for orders the app has requested and drives them
// through Sainsbury's, talking to the app through the order document:
//
//   requested → logging_in → need_code (app writes smsCode) → choose_slot (app writes slotChoice)
//   → filling → review (app writes approvedBy) → placing → placed
//   any step → failed | cancelled (app writes cancelRequested) | needs_you
//   A trial order (trial: true, from Settings) goes to Sainsbury's checkout
//   but stops before Place order → trial_done, then empties what it added.
//   An amend order (amend: { orderNumber, of }, from "Add to this order") opens
//   a placed order on Sainsbury's instead of booking a slot, adds to it, and
//   confirms the change after approval.
//   A run that stops part way is never restarted (see the claim below), and an
//   order nobody picked up within START_MINUTES is never started.
//
// Usage:  xvfb-run -a node worker/run.mjs            process waiting orders, then exit
//         node worker/run.mjs check                  recipe links, ideas and methods; says if orders are waiting
// Env:    WORKER_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT (JSON) or GOOGLE_APPLICATION_CREDENTIALS,
//         SAINSBURYS_EMAIL, SAINSBURYS_PASSWORD, WORKER_MINUTES (default 50)

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import { FakeSainsburys } from './fake.mjs';
import { makeJobs } from './jobs.mjs';
import { notify } from './notify.mjs';
import { claudeUsual, claudeSwaps } from './ideas-claude.mjs';
import { households as allowedHouseholdDocs } from './access.mjs';

// SAINSBURYS_FAKE=1 swaps in a pretend shop, for testing the app end to end.
// The real one loads Playwright, so it's imported only when needed.
const Sainsburys = process.env.SAINSBURYS_FAKE ? FakeSainsburys : null;
async function makeShop(opts) {
  if (Sainsburys) return new Sainsburys(opts);
  const { Sainsburys: Real } = await import('./sainsburys.mjs');
  return new Real(opts);
}
import { iso, daysBetween, upcomingOrders, ordersNear, usualCandidates, searchTerms, cheapestSwap, priceChange } from '../js/plan.js';

// The worker's own key if it has one (database and notifications only), else the deploy key.
const sa = process.env.WORKER_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT;
initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: process.env.GCLOUD_PROJECT || 'weekly-shop-177b1' }
  : { credential: sa ? cert(JSON.parse(sa)) : applicationDefault() });
const db = getFirestore();
const { makeIdeas, processImport, claimImport, claimIdeas, fillIngredients, fillRecipe, afterPlaced, finishElsewhere } = makeJobs(db);

const DEADLINE = Date.now() + (Number(process.env.WORKER_MINUTES) || 50) * 60000;
const ACTIVE = ['requested', 'logging_in', 'need_code', 'choose_slot', 'filling', 'review', 'placing'];
// An order the worker hasn't picked up within this long is never started: the
// instant start failed and GitHub's backup timer can be hours late, and nobody
// wants an SMS code at 3am for an order they gave up on. The app offers "Try again".
export const START_MINUTES = 15;
const CODE_MINUTES = 10;
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cancelled extends Error {}

// Only the household(s) this app is for (worker/access.mjs).
const households = () => allowedHouseholdDocs(db);

// "Ask Claude for ideas" in the app sets ideasRequested on the week.
async function requestedIdeas() {
  for (const h of await households()) {
    const q = await h.ref.collection('weeks').where('ideasRequested', '==', true).get();
    for (const w of q.docs) {
      if (await claimIdeas(w.ref)) await makeIdeas(h, w.id, 'request', Object.keys(w.data().picks || {}));
    }
  }
}

// Recipes asked for on the Recipes screen (the functions usually do these first).
async function requestedRecipes() {
  for (const h of await households()) {
    const q = await h.ref.collection('meals').where('recipeRequested', '==', true).get();
    for (const m of q.docs) await fillRecipe(h, m.ref);
  }
}

// ---------- orders ----------
async function waitingOrders() {
  const out = [];
  for (const h of await households()) {
    const q = await h.ref.collection('orders').where('state', 'in', ACTIVE).get();
    out.push(...q.docs.map(d => ({ h, ref: d.ref, data: d.data() })));
  }
  return out;
}

// "I finished it in the Sainsbury's app" (the finishElsewhere function usually does these first).
async function finishedElsewhere() {
  for (const h of await households()) {
    const q = await h.ref.collection('orders').where('state', '==', 'needs_you').get();
    for (const d of q.docs) if (d.data().finishedElsewhere) await finishElsewhere(h, d.ref);
  }
}

// ---------- recipe links ----------
async function waitingImports() {
  const out = [];
  for (const h of await households()) {
    const q = await h.ref.collection('imports').where('state', '==', 'requested').get();
    out.push(...q.docs.map(d => ({ h, ref: d.ref, data: d.data() })));
  }
  return out;
}


async function processOrder({ h, ref }) {
  const logLines = [];
  const update = async (data) => { await ref.update(data); };
  const log = async (msg) => {
    const line = `${new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London' })} ${msg}`;
    // The repo is public, so Actions logs are too: keep details in the order doc only.
    if (!process.env.WORKER_QUIET) console.log(line);
    logLines.push(line);
    await ref.update({ log: FieldValue.arrayUnion(line) }).catch(() => {});
  };
  const read = async () => (await ref.get()).data();
  // Wait for the app to write a field; checks for cancel and the deadline.
  const waitFor = async (pick, minutes) => {
    const until = Math.min(DEADLINE, Date.now() + minutes * 60000);
    while (Date.now() < until) {
      const d = await read();
      if (d.cancelRequested) throw new Cancelled();
      const v = await pick(d);
      if (v) return v;
      await sleep(3000);
    }
    return null;
  };

  const order = await read();
  // Claim it so a second worker run doesn't pick it up too.
  const claimed = await db.runTransaction(async t => {
    const d = (await t.get(ref)).data();
    const age = d.createdAt ? (Date.now() - d.createdAt.toMillis()) / 60000 : 0;
    if (d.state === 'requested' && age > START_MINUTES) {
      t.update(ref, { state: 'cancelled', message: `The order helper didn't start within ${START_MINUTES} minutes, so it wasn't started late. Nothing happened on Sainsbury's. Tap Try again to send it now.`, notStarted: true });
      return false;
    }
    if (d.state !== 'requested') {
      // Another run is working on it (it updates workerAt every minute).
      if (d.workerAt && Date.now() - d.workerAt.toMillis() < 5 * 60000) return false;
      // A run that stopped part way is never restarted: a restart would add
      // everything to the basket a second time, and must never act on an
      // approval given for the earlier basket. If it stopped while placing,
      // the order may well have gone through.
      t.update(ref, d.state === 'placing'
        ? { state: 'needs_you', message: 'The order helper stopped while placing the order, so it may have gone through. Check your orders in the Sainsbury\'s app before starting again.' }
        : { state: 'failed', message: 'The order helper stopped part way. The slot and some items may still be in your Sainsbury\'s basket: check the Sainsbury\'s app, then start again.' });
      return false;
    }
    t.update(ref, { state: 'logging_in', workerAt: FieldValue.serverTimestamp(), message: FieldValue.delete(), approvedBy: FieldValue.delete(), approvedTotal: FieldValue.delete() });
    return true;
  });
  if (!claimed) return;
  const heartbeat = setInterval(() => ref.update({ workerAt: FieldValue.serverTimestamp() }).catch(() => {}), 60000);

  const shop = await makeShop({ store: h.data().store || '0031', log: m => log(m) });
  let reserved = false, slotDate = null, amending = false, placedDone = false;
  let amendNo = null; // the Sainsbury's order being added to, if it isn't a new one
  try {
    if (order.cancelRequested) throw new Cancelled();
    await shop.open();
    await log('Logging in to Sainsbury\'s');
    await shop.login(process.env.SAINSBURYS_EMAIL, process.env.SAINSBURYS_PASSWORD, async () => {
      await update({ state: 'need_code', smsCode: FieldValue.delete(), codeAt: FieldValue.serverTimestamp() });
      // The code goes to one phone (Settings › Household › SMS code goes to), so ask that person.
      const codeTo = h.data().codeTo || null;
      await notify(h, { title: 'Sainsbury\'s needs the SMS code', body: `Type the 6-digit code from your text into the app. It's needed within ${CODE_MINUTES} minutes.`, link: '#/order', tag: 'order', to: codeTo });
      const code = await waitFor(d => d.smsCode, CODE_MINUTES);
      if (!code) throw new Error(`No SMS code came in within ${CODE_MINUTES} minutes.`);
      await update({ smsCode: FieldValue.delete(), state: 'logging_in' });
      return code;
    });

    // Which order this shop goes into: a new slot, or an order already placed.
    const picked = order.amend
      ? { amendNo: order.amend.orderNumber }
      : await chooseSlot({ h, order, shop, update, log, waitFor });
    let res = picked.res || null;
    const choice = picked.choice;
    amendNo = picked.amendNo || null;
    if (amendNo) {
      // Adding to an order already placed: open it on Sainsbury's (its slot stays as it is).
      await log(`Opening order ${amendNo} to add to it`);
      await update({ state: 'filling', message: FieldValue.delete() });
      const opened = await shop.startAmend(amendNo);
      amending = true;
      res = { slot: opened.slot, reserved_until: new Date(Date.now() + 100 * 60000).toISOString() };
      slotDate = opened.slotDate;
      await update({ slot: opened.slot ? { start_time: opened.slot.start_time, end_time: opened.slot.end_time || '' } : null, ...(opened.slot?.start_time ? { deliveryDate: londonDate(opened.slot.start_time) } : {}) });
    } else {
      reserved = true;
      // The slot can be on a different day from the one picked in the plan (slots
      // around that day are offered): from here the order is for the slot's day.
      await update({ state: 'filling', message: FieldValue.delete(), deliveryDate: londonDate(res.slot.start_time), slot: { start_time: res.slot.start_time, end_time: res.slot.end_time, reserved_until: res.reserved_until } });
      await log(`Booked ${choice}`);
      slotDate = res.slot.start_time.slice(0, 10);
    }

    // Basket
    const before = await shop.basket(slotDate);
    if (before?.items?.length) await log(amendNo ? `The order has ${before.items.length} items so far` : `The basket already had ${before.items.length} items; they're kept`);
    const lines = (await read()).lines || [];
    await pickUsual(h, lines, log);
    await pickCheaper(h, lines, shop, log);
    await update({ lines });
    for (const line of lines) {
      try {
        let uid = line.uid;
        if (!uid) {
          const hits = (await shop.search(line.search || line.name)).filter(p => p.available);
          if (!hits.length) { line.result = 'not_found'; continue; }
          uid = hits[0].uid; line.uid = uid; line.product = hits[0].name;
        }
        try {
          await shop.add(uid, line.qty || 1, slotDate);
        } catch (e) {
          // A cheaper swap that won't go in: go back to the product it replaced.
          if (line.swap && e.status === 400) {
            Object.assign(line, { uid: line.swap.fromUid, product: line.swap.from }); delete line.swap;
            await shop.add(line.uid, line.qty || 1, slotDate);
            line.result = 'added';
            continue;
          }
          // A usual product from a past order may have been discontinued: fall back to a search.
          if (!((line.source === 'list' || line.usual) && e.status === 400 && line.search)) throw e;
          const hits = (await shop.search(line.search)).filter(p => p.available && String(p.uid) !== String(uid));
          if (!hits.length) throw e;
          line.uid = hits[0].uid; line.product = hits[0].name;
          await shop.add(line.uid, line.qty || 1, slotDate);
          await log(`${line.name}: the usual one wasn't available, so it's ${hits[0].name}`);
        }
        line.result = 'added';
      } catch (e) {
        line.result = e.status === 400 ? 'unavailable' : `error ${e.status || e.message}`;
      }
    }
    // Prices from earlier baskets, to say what's gone up (and remembered for the Basket screen's estimate).
    const pricesRef = h.ref.collection('meta').doc('prices');
    const pastPrices = (await pricesRef.get()).data()?.items || {};
    const readBasket = async () => {
      const b = await shop.basket(slotDate);
      const items = (b.items || []).map(i => {
        const uid = i.product?.sku, qty = Number(i.quantity) || 1, total = Number(i.subtotal_price);
        const up = priceChange(pastPrices[String(uid)]?.p, total / qty);
        return { uid, name: i.product?.name, qty, total, offer: (i.promotions || [])[0]?.strap_line || '', ...(up ? { change: up } : {}) };
      });
      return { b, basket: { items, subtotal: Number(b.subtotal_price), savings: Number(b.savings || 0), delivery: Number(b.slot_price ?? (b.total_price - b.subtotal_price)), minimum: b.minimum_spend }, total: Number(b.total_price) };
    };
    const rememberPrices = async items => {
      const today = iso(new Date());
      const now = Object.fromEntries(items.filter(i => i.uid != null && i.total > 0).map(i => [String(i.uid), { p: Math.round(i.total / (i.qty || 1) * 100) / 100, d: today }]));
      await pricesRef.set({ items: now }, { merge: true }).catch(e => console.log(`Prices not saved: ${e.message}`));
    };
    let { b, basket, total } = await readBasket();
    const added = lines.filter(l => l.result === 'added').length;
    await log(`Added ${added} of ${lines.length} lines, total £${total.toFixed(2)}`);
    await rememberPrices(basket.items);
    if (b.has_exceeded_minimum_spend === false) {
      if (order.trial) throw new Error(`Trial: the basket came to under Sainsbury's £${b.minimum_spend} minimum, so checkout couldn't be tried.`);
      await update({ state: 'needs_you', lines, basket, total, message: `The basket is under Sainsbury's £${b.minimum_spend} minimum, so it can't be ordered yet. Add more in the Sainsbury's app, or cancel.` });
      reserved = false; amending = false; // leave the slot (or the changes) for them to finish in the app
      return;
    }
    // Only an approval given for this basket counts.
    await update({ state: 'review', lines, basket, total, approvedBy: FieldValue.delete(), approvedTotal: FieldValue.delete() });
    await notify(h, order.trial
      ? { title: `Trial basket ready: £${Number(total).toFixed(2)}`, body: 'Check it, then tap Check out (trial). Nothing is paid.', link: '#/order', tag: 'order' }
      : { title: amendNo ? `Changed order ready: £${Number(total).toFixed(2)}` : `Basket ready: £${Number(total).toFixed(2)}`, body: amendNo ? 'Check it and tap Approve to update the order.' : 'Check it and tap Approve to place the order.', link: '#/order', tag: 'order' });

    // Approval (the slot is held for about 2 hours)
    const holdMins = Math.max(5, (new Date(res.reserved_until) - Date.now()) / 60000 - 5);
    // "Switch back" on the review screen: take the offer swap out and put
    // the product it replaced back in, then show the new total.
    const undoSwaps = async d => {
      const todo = lines.filter(l => l.swap && (d.undoSwaps || []).includes(l.key));
      if (!todo.length) return false;
      for (const l of todo) {
        try {
          await shop.remove(l.uid, l.qty || 1, slotDate);
          await shop.add(l.swap.fromUid, l.qty || 1, slotDate);
          l.undone = { product: l.product, offer: l.swap.offer, saving: l.swap.saving };
          Object.assign(l, { uid: l.swap.fromUid, product: l.swap.from }); delete l.swap;
          await log(`Switched back to ${l.product}`);
        } catch (e) {
          l.swap.error = 'Couldn\'t switch it back. Change it in the Sainsbury\'s app.';
          l.swap.failed = true;
        }
      }
      ({ basket, total } = await readBasket());
      await update({ lines, basket, total });
      return true;
    };
    // "Refresh the total" (after changing things in the Sainsbury's app) and
    // "Remove" on things that were already in the basket.
    let refreshed = order.refreshAsked || 0;
    const removed = new Set();
    const removedQty = new Map(); // so a trial can put them back
    const refresh = async d => {
      const gone = (d.removeExtras || []).filter(u => !removed.has(String(u)));
      if (!gone.length && !(d.refreshAsked && d.refreshAsked !== refreshed)) return false;
      for (const u of gone) {
        removed.add(String(u));
        const item = basket.items.find(i => String(i.uid) === String(u));
        try { await shop.remove(u, item?.qty || 999, slotDate); removedQty.set(String(u), item?.qty || 1); await log(`Took ${item?.name || 'an item'} out of the basket`); }
        catch (e) { await log(`Couldn't take ${item?.name || 'an item'} out: ${e.message}`); }
      }
      refreshed = d.refreshAsked || refreshed;
      ({ basket, total } = await readBasket());
      await update({ basket, total, refreshedAt: FieldValue.serverTimestamp() });
      return true;
    };
    const ok = await waitFor(async d => {
      const changed = await refresh(d);
      if (changed && d.approvedBy && Math.abs((d.approvedTotal || 0) - total) > 0.005) { await update({ approvedBy: FieldValue.delete(), approvedTotal: FieldValue.delete() }); return null; }
      if (await undoSwaps({ undoSwaps: (d.undoSwaps || []).filter(k => !lines.find(l => l.key === k)?.swap?.failed) })) {
        // An approval of the old total doesn't count for the new one.
        if (d.approvedBy && Math.abs((d.approvedTotal || 0) - total) > 0.005) { await update({ approvedBy: FieldValue.delete(), approvedTotal: FieldValue.delete() }); return null; }
      }
      // The approval must be for the total on screen.
      if (d.approvedBy && Math.abs((d.approvedTotal ?? -1) - total) > 0.005) return null;
      return d.approvedBy;
    }, Math.min(holdMins, 100));
    if (!ok) {
      if (order.trial) throw new Error('Trial: nobody tapped Check out in time.');
      await update({ state: 'needs_you', message: amendNo ? 'Nobody approved the change in time. The items are still in your Sainsbury\'s basket: confirm or cancel the changes in the Sainsbury\'s app.' : 'Nobody approved the order in time. The basket and slot are still in your Sainsbury\'s account: check out in the Sainsbury\'s app, or start again here.' });
      reserved = false; amending = false;
      return;
    }
    if (order.trial) {
      // Trial run: go all the way to Sainsbury's checkout and read the total,
      // but don't press Place order. Then take out what was added and let the
      // slot go (or, on an order already booked, put back anything removed and
      // cancel the changes, so the order is as it was).
      await update({ state: 'placing' });
      await log(`Trial: checking out (won't place the order), asked by ${ok.name}`);
      let checked = null, why = '';
      try { checked = await shop.placeOrder(total, { dryRun: true, amend: !!amendNo }); } catch (e) { why = e.message; }
      for (const l of lines) if (l.result === 'added' && l.uid) await shop.remove(l.uid, l.qty || 1, slotDate).catch(() => {});
      for (const [u, q] of removedQty) await shop.add(u, q, slotDate).catch(() => {});
      if (amending) { await shop.cancelAmend().catch(e => log(`Couldn't cancel the changes: ${e.message}`)); amending = false; }
      if (reserved) { await shop.release().catch(() => {}); reserved = false; }
      const after = amendNo ? 'the changes were cancelled, so your order is as it was' : 'the slot was released';
      await update(checked
        ? { state: 'trial_done', checkoutTotal: checked.total, card: checked.card || '', message: `Trial finished. Everything worked up to ${amendNo ? 'saving the changes' : 'Place order'}: Sainsbury's checkout showed £${Number(checked.total).toFixed(2)}${checked.card ? ` with ${checked.card}` : ''}. Nothing was paid, the items it added were taken out again and ${after}.` }
        : { state: 'failed', message: `Trial: the basket was filled, but checkout didn't work: ${why} Nothing was paid; the items it added were taken out and ${after}.` });
      await log(checked ? 'Trial finished' : `Trial stopped at checkout: ${why}`);
      await notify(h, { title: checked ? 'Trial order worked' : 'Trial order stopped at checkout', body: checked ? `Everything up to ${amendNo ? 'saving the changes' : 'Place order'} worked. Nothing was paid.` : why.slice(0, 150), link: '#/order', tag: 'order' });
      return;
    }
    await update({ state: 'placing' });
    await log(`Approved by ${ok.name}, ${amendNo ? 'confirming the change' : 'placing the order'}`);
    const placed = amendNo ? await shop.confirmAmend(total) : await shop.placeOrder(total);
    reserved = false; amending = false;
    let orderNumber = placed.orderNumber || amendNo || '';
    if (!amendNo) {
      const recent = await shop.orders().catch(() => []);
      const match = recent.find(o => String(o.slot_start_time || '').startsWith(res.slot.start_time.slice(0, 16)) || (orderNumber && String(o.order_uid) === orderNumber));
      if (match) orderNumber = orderNumber || String(match.order_uid);
    }
    // From here the order has gone through: nothing below may mark it as stopped.
    placedDone = true;
    const when = res.slot?.start_time ? new Date(res.slot.start_time).toLocaleString('en-GB', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London' }) : '';
    await update({ state: 'placed', orderNumber, card: placed.card || '', total: placed.total || total, placedAt: FieldValue.serverTimestamp() });
    await log(amendNo ? `Order ${orderNumber} updated` : `Order placed${orderNumber ? ` (#${orderNumber})` : ''}`);
    await notify(h, amendNo
      ? { title: 'Order updated', body: `Now £${Number(placed.total || total).toFixed(2)}${when ? `, delivery ${when}` : ''}.`, link: '#/order', tag: 'order' }
      : { title: 'Order placed', body: `£${Number(placed.total || total).toFixed(2)}, delivery ${when}.`, link: '#/order', tag: 'order' });
    try {
      if (order.amend?.of) await h.ref.collection('orders').doc(order.amend.of).set({ total: placed.total || total, amendedBy: FieldValue.arrayUnion({ id: ref.id, at: new Date(), by: ok.name || '' }) }, { merge: true });
      await afterPlaced(h, order, lines, slotDate || order.deliveryDate);
    } catch (e) {
      // The order went through: only the tidy-up (staples, meals, the list) failed.
      await log(`The order went through, but updating staples and the list didn't: ${e.message}`);
      await update({ message: 'The order went through. Updating staples, meals and the list didn\'t finish, so check the list before the next shop.' }).catch(() => {});
    }
  } catch (e) {
    if (placedDone) {
      // Should never happen (the tidy-up has its own catch), but a placed order stays placed.
      console.error(`After placing: ${e.message}`);
    } else if (e instanceof Cancelled) {
      // A trial (or a change to a placed order) takes out what it added; a real order leaves the basket for the Sainsbury's app.
      if ((order.trial || amendNo) && slotDate) for (const l of (await read()).lines || []) if (l.result === 'added' && l.uid) await shop.remove(l.uid, l.qty || 1, slotDate).catch(() => {});
      if (amending) await shop.cancelAmend().catch(() => {});
      if (reserved) await shop.release().catch(() => {});
      await update({ state: 'cancelled', message: order.trial ? `Trial cancelled. ${amendNo ? 'The changes were cancelled' : 'The slot was released'} and anything it added was taken out again.` : amendNo ? 'Cancelled. What it added was taken out again and the order is as it was. Check the Sainsbury\'s app if you want to be sure.' : 'Cancelled. The slot was released; anything already in the basket was left there.' });
      await log('Cancelled');
    } else if (e.code === 'BANK_CHECK') {
      await update({ state: 'needs_you', message: e.message });
      await notify(h, { title: 'The order needs you', body: e.message.slice(0, 150), link: '#/order', tag: 'order' });
      await log(e.message);
    } else {
      console.error(process.env.WORKER_QUIET ? `Order stopped: ${e.message}` : e);
      const d = await read().catch(() => ({}));
      if (d.state === 'placed') return; // never turn a placed order into a stopped one
      if ((order.trial || (amendNo && d.state !== 'placing')) && slotDate) for (const l of d.lines || []) if (l.result === 'added' && l.uid) await shop.remove(l.uid, l.qty || 1, slotDate).catch(() => {});
      if (amending && d.state !== 'placing') await shop.cancelAmend().catch(() => {});
      const placing = d.state === 'placing' && !order.trial;
      if (reserved && !placing) await shop.release().catch(() => {});
      // Sainsbury's own words go on the order screen only (the Actions log is public).
      const msg = e.detail && !e.message.includes(e.detail) ? `${e.message} (Sainsbury's said: ${e.detail})` : e.message;
      await update({ state: placing ? 'needs_you' : 'failed', stoppedAt: d.state || null, message: placing ? `Something went wrong while placing the order: ${msg} Check the Sainsbury's app before trying again.` : msg });
      await log(`Stopped: ${msg}`);
    }
  } finally {
    clearInterval(heartbeat);
    await shop.close();
  }
}

// Where a new shop goes: an order already booked in the Sainsbury's app near
// the delivery day (offered alongside the free slots; a plan marked "already
// booked" goes straight into the one it finds), or a newly booked slot.
// Returns { amendNo } for an existing order, or { res, choice } for a slot.
async function chooseSlot({ h, order, shop, update, log, waitFor }) {
  const day = order.deliveryDate;
  let existing = [];
  try { existing = ordersNear(upcomingOrders(await shop.orders()), day, !!order.booked); }
  catch (e) { await log(`Couldn't read the orders already booked on Sainsbury's (${e.status || e.message}), so only new slots are offered`); }
  if (existing.length) await log(`${existing.length} order${existing.length === 1 ? '' : 's'} already booked around ${day}`);
  const useOrder = async (num, how) => {
    const ex = existing.find(o => o.orderNumber === num);
    await log(`${how} the order booked for ${ex?.date || 'then'}`);
    await update({ addTo: ex ? { orderNumber: num, start_time: ex.start_time, end_time: ex.end_time, total: ex.total } : { orderNumber: num }, existing: FieldValue.delete(), slots: FieldValue.delete() });
    return { amendNo: num };
  };
  if (order.booked && existing.length === 1) return useOrder(existing[0].orderNumber, 'Using');
  const bookedNote = order.booked && !existing.length
    ? `Couldn't find an order booked on Sainsbury's around ${day} that can still be changed. Pick a time to book a new slot, or cancel and check the Sainsbury's app.`
    : null;

  // Slots: the chosen day and the day either side. If Sainsbury's says the
  // picked one has gone, the list is refreshed and offered again (3 tries).
  const nearSlots = async (skip = new Set()) => (await shop.slots([1, 2, 3]))
    .filter(s => Math.abs(daysBetween(day, s.start_time.slice(0, 10))) <= 1 && !skip.has(s.start_time))
    .map(s => ({ start_time: s.start_time, end_time: s.end_time, price: s.price, is_green: !!s.is_green, date: londonDate(s.start_time), booking_key: s.booking_key }));
  const gone = new Set();
  let near = await nearSlots();
  for (let attempt = 1; ; attempt++) {
    const msg = attempt > 1 ? 'Sainsbury\'s says that slot has just gone. Pick another one.' : bookedNote;
    await update({ state: 'choose_slot', slots: near.map(({ booking_key, ...s }) => s), existing, slotChoice: FieldValue.delete(), ...(msg ? { message: msg } : {}) });
    await log(`${near.length} free slots around ${day}`);
    if (attempt === 1) await notify(h, existing.length
      ? { title: 'Add to your order, or pick a time', body: 'You already have a Sainsbury\'s order around then. Add this shop to it, or book a new slot.', link: '#/order', tag: 'order' }
      : { title: 'Pick a delivery time', body: `${near.length} free slots around your chosen day.`, link: '#/order', tag: 'order' });
    const choice = await waitFor(d => d.slotChoice, 30);
    if (!choice) throw new Error('No delivery time was picked within 30 minutes.');
    if (choice.startsWith('order:')) return useOrder(choice.slice(6), 'Adding to');
    // Keys can go stale: refresh before booking.
    const slot = (await shop.slots([1, 2, 3])).find(s => s.start_time === choice) || near.find(s => s.start_time === choice);
    try {
      if (!slot) { const e = new Error('That slot has gone.'); e.detail = 'no longer available'; throw e; }
      return { res: await shop.reserve(slot), choice };
    } catch (e) {
      if (!/no longer available|not available|gone/i.test(`${e.detail || ''} ${e.message}`) || attempt >= 3) throw e;
      await log(`${choice} had gone; offering the others`);
      gone.add(choice);
      near = await nearSlots(gone);
    }
  }
}

function londonDate(t) {
  return new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

// Meal ingredients get "your usual" product: Claude picks from what the
// household bought before (free range chicken if that's what they buy).
// Anything it can't match is left to the shop's search.
async function pickUsual(h, lines, log) {
  const products = (await h.ref.collection('meta').doc('products').get()).data()?.items || [];
  // A pick saved from an earlier order is asked again, so a switch to another product is learned.
  const asks = lines.filter(l => l.source === 'meal' && (!l.uid || l.usual))
    .map(l => ({ key: l.key, item: l.name, candidates: usualCandidates(l.name, products).map(({ u, n, c, l: last }) => ({ u, n, c, l: last })) }))
    .filter(a => a.candidates.length);
  if (!asks.length) return;
  let picks;
  try { picks = await claudeUsual(asks); } catch (e) { await log(`Couldn't pick usual products: ${e.message}`); return; }
  if (!picks) return;
  const byUid = new Map(products.map(p => [String(p.u), p]));
  for (const l of lines) {
    const uid = picks[l.key];
    if (!uid) continue;
    Object.assign(l, { uid, product: byUid.get(uid)?.n || '', usual: true });
  }
  const n = Object.keys(picks).length;
  if (n) await log(`Picked your usual product for ${n} meal ingredient${n === 1 ? '' : 's'}`);
}

// Cheaper swaps: for each line, look at what else Sainsbury's has, ask Claude
// which of those are the same thing as the product it would get (keeping
// organic, free range, cut, brand where it matters and the household notes),
// and buy the one with the lowest price per kg/litre/each after offers, Nectar
// prices and multibuys the line qualifies for. Settings › Cheaper swaps turns
// it off; a staple set to "Always this one" is never swapped.
async function pickCheaper(h, lines, shop, log) {
  if (h.data().cheaperSwaps === false) return;
  const asks = [], found = new Map();
  await log('Checking prices, offers and Nectar prices');
  for (const l of lines) {
    if (l.keep) continue;
    let hits;
    try { hits = await shop.search(l.search || searchTerms(l.product || l.name) || l.name, 12); } catch { continue; }
    let ref = l.uid ? hits.find(p => String(p.uid) === String(l.uid)) : hits.find(p => p.available);
    if (!ref && l.uid && l.product) {
      try { ref = (await shop.search(l.product, 5)).find(p => String(p.uid) === String(l.uid)); } catch {}
    }
    if (!ref) continue;
    if (!l.uid) Object.assign(l, { uid: String(ref.uid), product: ref.name });
    // Only what's cheaper per kg/litre/each and a similar size goes to Claude.
    const options = hits.filter(p => cheapestSwap(ref, [p], l.qty || 1));
    found.set(l.key, { ref, options });
    if (options.length) asks.push({ key: l.key, item: l.name, current: { u: String(ref.uid), n: ref.name }, options: options.map(p => ({ u: String(p.uid), n: p.name })) });
  }
  if (!asks.length) return;
  let same;
  try { same = await claudeSwaps(asks, h.data().notes || ''); } catch (e) { await log(`Couldn't check for cheaper swaps: ${e.message}`); return; }
  if (!same) return;
  let n = 0, saved = 0;
  for (const l of lines) {
    const f = found.get(l.key), ok = new Set(same[l.key] || []);
    if (!f || !ok.size) continue;
    const swap = cheapestSwap(f.ref, f.options.filter(p => ok.has(String(p.uid))), l.qty || 1);
    if (!swap) continue;
    const p = swap.product;
    l.swap = { from: f.ref.name, fromUid: String(f.ref.uid), saving: swap.saving, offer: p.offer || '' };
    Object.assign(l, { uid: String(p.uid), product: p.name });
    n++; saved += swap.saving;
  }
  if (n) await log(`Cheaper swaps: ${n}, saving about £${saved.toFixed(2)}`);
}

async function main() {
  if (process.argv[2] === 'check') {
    // Quick look before the workflow installs a browser.
    const n = (await waitingOrders()).length;
    console.log(n ? `${n} order(s) waiting` : 'No orders waiting');
    // Recipe links and idea requests don't need the browser, so do them straight away.
    for (const i of await waitingImports()) if (await claimImport(i.ref)) await processImport(i);
    await requestedIdeas();
    // Ingredients first: a dinner typed on Next shop asks for its method once they're in.
    for (const h of await households()) await fillIngredients(h);
    await requestedRecipes();
    await finishedElsewhere();
    if (process.env.GITHUB_OUTPUT) (await import('node:fs')).appendFileSync(process.env.GITHUB_OUTPUT, `work=${n ? 'yes' : 'no'}\n`);
    return;
  }
  for (const i of await waitingImports()) if (await claimImport(i.ref)) await processImport(i);
  await requestedIdeas();
  await requestedRecipes();
  if (!process.env.SAINSBURYS_EMAIL || !process.env.SAINSBURYS_PASSWORD) throw new Error('SAINSBURYS_EMAIL and SAINSBURYS_PASSWORD must be set');
  const waiting = await waitingOrders();
  if (!waiting.length) { console.log('No orders waiting'); return; }
  console.log(`${waiting.length} order(s) to do`);
  for (const o of waiting) await processOrder(o);
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
