// Order worker. Looks for orders the app has requested and drives them
// through Sainsbury's, talking to the app through the order document:
//
//   requested → logging_in → need_code (app writes smsCode) → choose_slot (app writes slotChoice)
//   → filling → review (app writes approvedBy) → placing → placed
//   any step → failed | cancelled (app writes cancelRequested) | needs_you
//
// Usage:  xvfb-run -a node worker/run.mjs            process waiting orders, then exit
//         node worker/run.mjs ideas                  make this week's 10 meal ideas if missing
// Env:    FIREBASE_SERVICE_ACCOUNT (JSON) or GOOGLE_APPLICATION_CREDENTIALS,
//         SAINSBURYS_EMAIL, SAINSBURYS_PASSWORD, WORKER_MINUTES (default 50)

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import { FakeSainsburys } from './fake.mjs';
import { makeJobs } from './jobs.mjs';
import { notify } from './notify.mjs';
import { claudeUsual } from './ideas-claude.mjs';

// SAINSBURYS_FAKE=1 swaps in a pretend shop, for testing the app end to end.
// The real one loads Playwright, so it's imported only when needed.
const Sainsburys = process.env.SAINSBURYS_FAKE ? FakeSainsburys : null;
async function makeShop(opts) {
  if (Sainsburys) return new Sainsburys(opts);
  const { Sainsburys: Real } = await import('./sainsburys.mjs');
  return new Real(opts);
}
import { pickIdeas, weekId, iso, daysBetween, awayWeek, SKIPS_TO_SUGGEST, learnStaple, recordBought, usualCandidates } from '../js/plan.js';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: process.env.GCLOUD_PROJECT || 'weekly-shop-177b1' }
  : { credential: sa ? cert(JSON.parse(sa)) : applicationDefault() });
const db = getFirestore();
const { makeIdeas, processImport, claimImport, claimIdeas, fillIngredients } = makeJobs(db);

const DEADLINE = Date.now() + (Number(process.env.WORKER_MINUTES) || 50) * 60000;
const ACTIVE = ['requested', 'logging_in', 'need_code', 'choose_slot', 'filling', 'review', 'placing'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cancelled extends Error {}

async function households() {
  return (await db.collection('households').get()).docs;
}

// ---------- Sunday ideas ----------
async function ideas() {
  const sunday = weekId(new Date());
  for (const h of await households()) {
    const ref = h.ref.collection('weeks').doc(sunday);
    if ((await ref.get()).exists) continue;
    if (awayWeek(h.data().away, sunday)) { console.log(`Away for week ${sunday}, no ideas`); continue; }
    await makeIdeas(h, sunday, 'sunday');
    await notify(h, { title: 'This week\'s meal ideas are ready', body: 'Pick your dinners and a delivery day.', link: '#/week', tag: 'ideas' });
  }
}


// "Ask Claude for ideas" in the app sets ideasRequested on the week.
async function requestedIdeas() {
  for (const h of await households()) {
    const q = await h.ref.collection('weeks').where('ideasRequested', '==', true).get();
    for (const w of q.docs) {
      if (await claimIdeas(w.ref)) await makeIdeas(h, w.id, 'request', Object.keys(w.data().picks || {}));
    }
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
      const v = pick(d);
      if (v) return v;
      await sleep(3000);
    }
    return null;
  };

  const order = await read();
  // Claim it so a second worker run doesn't pick it up too.
  const claimed = await db.runTransaction(async t => {
    const d = (await t.get(ref)).data();
    if (d.state !== 'requested' && d.workerAt && Date.now() - d.workerAt.toMillis() < 5 * 60000) return false;
    // A run that died part way and was left for hours: don't restart it out of the blue.
    if (d.state !== 'requested' && (!d.workerAt || Date.now() - d.workerAt.toMillis() > 3 * 3600000)) {
      t.update(ref, { state: 'failed', message: 'The order helper stopped part way. Check the Sainsbury\'s app, then start again.' });
      return false;
    }
    t.update(ref, { state: 'logging_in', workerAt: FieldValue.serverTimestamp(), message: FieldValue.delete() });
    return true;
  });
  if (!claimed) return;
  const heartbeat = setInterval(() => ref.update({ workerAt: FieldValue.serverTimestamp() }).catch(() => {}), 60000);

  const shop = await makeShop({ store: h.data().store || '0031', log: m => log(m) });
  let reserved = false;
  try {
    if (order.cancelRequested) throw new Cancelled();
    await shop.open();
    await log('Logging in to Sainsbury\'s');
    await shop.login(process.env.SAINSBURYS_EMAIL, process.env.SAINSBURYS_PASSWORD, async () => {
      await update({ state: 'need_code', smsCode: FieldValue.delete() });
      await notify(h, { title: 'Sainsbury\'s needs the SMS code', body: 'Type the 6-digit code from your text into the app.', link: '#/order', tag: 'order' });
      const code = await waitFor(d => d.smsCode, 10);
      if (!code) throw new Error('No SMS code came in within 10 minutes.');
      await update({ smsCode: FieldValue.delete(), state: 'logging_in' });
      return code;
    });

    // Slots: the chosen day and the day either side.
    const all = await shop.slots([1, 2, 3]);
    const day = order.deliveryDate;
    const near = all.filter(s => Math.abs(daysBetween(day, s.start_time.slice(0, 10))) <= 1)
      .map(s => ({ start_time: s.start_time, end_time: s.end_time, price: s.price, is_green: !!s.is_green, date: londonDate(s.start_time), booking_key: s.booking_key }));
    await update({ state: 'choose_slot', slots: near.map(({ booking_key, ...s }) => s), slotChoice: FieldValue.delete() });
    await log(`${near.length} free slots around ${day}`);
    await notify(h, { title: 'Pick a delivery time', body: `${near.length} free slots around your chosen day.`, link: '#/order', tag: 'order' });
    const choice = await waitFor(d => d.slotChoice, 30);
    if (!choice) throw new Error('No delivery time was picked within 30 minutes.');
    let slot = near.find(s => s.start_time === choice);
    if (!slot) throw new Error('That slot has gone. Start the order again.');
    // Keys can go stale: refresh before booking.
    slot = (await shop.slots([1, 2, 3])).find(s => s.start_time === choice) || slot;
    const res = await shop.reserve(slot);
    reserved = true;
    await update({ state: 'filling', slot: { start_time: res.slot.start_time, end_time: res.slot.end_time, reserved_until: res.reserved_until } });
    await log(`Booked ${choice}`);

    // Basket
    const slotDate = res.slot.start_time.slice(0, 10);
    const before = await shop.basket();
    if (before?.items?.length) await log(`The basket already had ${before.items.length} items; they're kept`);
    const lines = (await read()).lines || [];
    await pickUsual(h, lines, log);
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
    const b = await shop.basket(slotDate);
    const items = (b.items || []).map(i => ({ uid: i.product?.sku, name: i.product?.name, qty: i.quantity, total: Number(i.subtotal_price), offer: (i.promotions || [])[0]?.strap_line || '' }));
    const basket = { items, subtotal: Number(b.subtotal_price), savings: Number(b.savings || 0), delivery: Number(b.slot_price ?? (b.total_price - b.subtotal_price)), minimum: b.minimum_spend };
    const total = Number(b.total_price);
    const added = lines.filter(l => l.result === 'added').length;
    await log(`Added ${added} of ${lines.length} lines, total £${total.toFixed(2)}`);
    if (b.has_exceeded_minimum_spend === false) {
      await update({ state: 'needs_you', lines, basket, total, message: `The basket is under Sainsbury's £${b.minimum_spend} minimum, so it can't be ordered yet. Add more in the Sainsbury's app, or cancel.` });
      reserved = false; // leave the slot for them to use
      return;
    }
    await update({ state: 'review', lines, basket, total });
    await notify(h, { title: `Basket ready: £${Number(total).toFixed(2)}`, body: 'Check it and tap Approve to place the order.', link: '#/order', tag: 'order' });

    // Approval (the slot is held for about 2 hours)
    const holdMins = Math.max(5, (new Date(res.reserved_until) - Date.now()) / 60000 - 5);
    const ok = await waitFor(d => d.approvedBy, Math.min(holdMins, 100));
    if (!ok) {
      await update({ state: 'needs_you', message: 'Nobody approved the order in time. The basket and slot are still in your Sainsbury\'s account: check out in the Sainsbury\'s app, or start again here.' });
      reserved = false;
      return;
    }
    await update({ state: 'placing' });
    await log(`Approved by ${ok.name}, placing the order`);
    const placed = await shop.placeOrder(total);
    reserved = false;
    let orderNumber = placed.orderNumber;
    const recent = await shop.orders().catch(() => []);
    const match = recent.find(o => String(o.slot_start_time || '').startsWith(res.slot.start_time.slice(0, 16)) || (orderNumber && String(o.order_uid) === orderNumber));
    if (match) orderNumber = orderNumber || String(match.order_uid);
    await update({ state: 'placed', orderNumber, card: placed.card || '', total: placed.total || total, placedAt: FieldValue.serverTimestamp() });
    await log(`Order placed${orderNumber ? ` (#${orderNumber})` : ''}`);
    await notify(h, { title: 'Order placed', body: `£${Number(placed.total || total).toFixed(2)}, delivery ${new Date(res.slot.start_time).toLocaleString('en-GB', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London' })}.`, link: '#/order', tag: 'order' });
    await afterPlaced(h, order, lines, res.slot.start_time.slice(0, 10));
  } catch (e) {
    if (e instanceof Cancelled) {
      if (reserved) await shop.release().catch(() => {});
      await update({ state: 'cancelled', message: 'Cancelled. The slot was released; anything already in the basket was left there.' });
      await log('Cancelled');
    } else if (e.code === 'BANK_CHECK') {
      await update({ state: 'needs_you', message: e.message });
      await notify(h, { title: 'The order needs you', body: e.message.slice(0, 150), link: '#/order', tag: 'order' });
      await log(e.message);
    } else {
      console.error(process.env.WORKER_QUIET ? `Order stopped: ${e.message}` : e);
      const d = await read().catch(() => ({}));
      const placing = d.state === 'placing';
      if (reserved && !placing) await shop.release().catch(() => {});
      await update({ state: placing ? 'needs_you' : 'failed', message: placing ? `Something went wrong while placing the order: ${e.message} Check the Sainsbury's app before trying again.` : e.message });
      await log(`Stopped: ${e.message}`);
    }
  } finally {
    clearInterval(heartbeat);
    await shop.close();
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

// Record what was bought: staples' last_bought, meals chosen, list items done.
async function afterPlaced(h, order, lines, delivery) {
  const b = db.batch();
  // Every staple bought, whether it came in as a staple, a meal ingredient or a
  // list item (same product), gets the date logged and its frequency re-learned.
  const staples = new Map((await h.ref.collection('staples').get()).docs.map(d => [d.id, d]));
  const bought = new Map();
  for (const l of lines) {
    if (l.result !== 'added') continue;
    const id = l.source === 'staple' ? l.key.slice(7) : l.uid && staples.has(String(l.uid)) ? String(l.uid) : null;
    if (id && staples.has(id)) bought.set(id, (bought.get(id) || 0) + (l.qty || 1));
    if (l.source === 'list' && l.listId) b.delete(h.ref.collection('list').doc(l.listId));
  }
  for (const [id, qty] of bought) b.set(staples.get(id).ref, { ...learnStaple(staples.get(id).data(), delivery, qty), skipped_on: FieldValue.delete() }, { merge: true });
  // Staples that were due but unticked: push them back, and count the skip.
  for (const id of order.skippedStaples || []) {
    const ref = h.ref.collection('staples').doc(id);
    const s = (await ref.get()).data() || {};
    const skips = (s.skips || 0) + 1;
    b.set(ref, { skips, skipped_on: delivery, ...(skips === SKIPS_TO_SUGGEST ? { learned: `Left out ${skips} times in a row, so it's a suggestion now` } : {}) }, { merge: true });
  }
  // Remember the usual products picked for meal ingredients, so next time they show in the shop.
  const mealPicks = new Map();
  for (const l of lines) if (l.source === 'meal' && l.usual && l.result === 'added') {
    const [, id, ...rest] = l.key.split(':'); const item = rest.join(':');
    if (!mealPicks.has(id)) mealPicks.set(id, new Map());
    mealPicks.get(id).set(item, { uid: l.uid, product: l.product });
  }
  for (const [id, picks] of mealPicks) {
    const ref = h.ref.collection('meals').doc(id);
    const m = (await ref.get()).data();
    if (m?.ingredients) b.set(ref, { ingredients: m.ingredients.map(g => picks.has(g.item) ? { ...g, ...picks.get(g.item) } : g) }, { merge: true });
  }
  for (const id of order.meals || []) b.set(h.ref.collection('meals').doc(id), { timesChosen: FieldValue.increment(1), lastChosen: delivery }, { merge: true });
  b.set(h.ref.collection('weeks').doc(order.week), { status: 'ordered', orderedFor: delivery }, { merge: true });
  // Everything bought joins the products list, so typed list items find "your usual".
  const pref = h.ref.collection('meta').doc('products');
  let products = (await pref.get()).data()?.items || [];
  for (const l of lines) if (l.result === 'added' && l.uid) products = recordBought(products, l.uid, l.product || l.name, delivery);
  b.set(pref, { items: products }, { merge: true });
  await b.commit();
}

async function main() {
  if (process.argv[2] === 'ideas') return ideas();
  if (process.argv[2] === 'check') {
    // Quick look before the workflow installs a browser.
    const n = (await waitingOrders()).length;
    console.log(n ? `${n} order(s) waiting` : 'No orders waiting');
    // Recipe links and idea requests don't need the browser, so do them straight away.
    for (const i of await waitingImports()) if (await claimImport(i.ref)) await processImport(i);
    await requestedIdeas();
    for (const h of await households()) await fillIngredients(h);
    if (process.env.GITHUB_OUTPUT) (await import('node:fs')).appendFileSync(process.env.GITHUB_OUTPUT, `work=${n ? 'yes' : 'no'}\n`);
    return;
  }
  for (const i of await waitingImports()) if (await claimImport(i.ref)) await processImport(i);
  await requestedIdeas();
  if (!process.env.SAINSBURYS_EMAIL || !process.env.SAINSBURYS_PASSWORD) throw new Error('SAINSBURYS_EMAIL and SAINSBURYS_PASSWORD must be set');
  const waiting = await waitingOrders();
  if (!waiting.length) { console.log('No orders waiting'); return; }
  console.log(`${waiting.length} order(s) to do`);
  for (const o of waiting) await processOrder(o);
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
