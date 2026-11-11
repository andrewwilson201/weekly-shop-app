// Runs the Firebase function handlers against the Firestore emulator, with a
// pretend Claude (the functions emulator can't register triggers in this sandbox):
//   firebase emulators:start --only firestore
//   node test/functions-check.mjs
process.env.FIRESTORE_EMULATOR_HOST ||= 'localhost:8081';
process.env.GCLOUD_PROJECT = 'weekly-shop-177b1';
process.env.CLAUDE_FAKE = '1';
process.env.ANTHROPIC_API_KEY = 'fake';
process.env.WORKER_GITHUB_TOKEN = 'fake-token';
// Check the access list (worker/access.mjs) here, which emulator tests otherwise skip.
process.env.ACCESS_CHECK = '1';
const fns = await import('../functions/index.mjs');
const { checkWorker, remindCutoff } = await import('../functions/tasks.mjs');
const { forgetAccessCache } = await import('../functions/shared/worker/access.mjs');
const { getFirestore, FieldValue } = await import('../functions/node_modules/firebase-admin/lib/firestore/index.js');
const db = getFirestore();
const assert = (c, m) => { if (!c) throw new Error(`FAILED: ${m}`); console.log(`ok - ${m}`); };

const h = db.collection('households').doc('fn-test');
await h.set({ members: ['u1'], name: 'Test', inviteCode: 'abcdefghijk' });
await db.collection('config').doc('access').set({ households: ['fn-test'] });
forgetAccessCache();

// A household that isn't on the access list gets nothing done for it.
const other = db.collection('households').doc('fn-stranger');
await other.set({ members: ['u9'], name: 'Stranger', inviteCode: 'zyxwvutsrqp' });
const strangerMeal = await other.collection('meals').add({ name: 'Free lunch', ingredients: [], timesChosen: 0 });
await fns.newMeal.run({ data: await strangerMeal.get(), params: { hid: 'fn-stranger', mid: strangerMeal.id } });
assert(!(await strangerMeal.get()).data().ingredients.length, 'a household not on the access list doesn\'t get Claude');
const strangerOrder = await other.collection('orders').add({ state: 'requested', week: '2026-11-01' });
await fns.startOrder.run({ data: await strangerOrder.get(), params: { hid: 'fn-stranger', oid: strangerOrder.id } });
assert((await strangerOrder.get()).data().state === 'cancelled', 'a household not on the access list can\'t start orders');
const meals = [];
for (let i = 0; i < 7; i++) meals.push(await h.collection('meals').add({ name: `Meal ${i}`, ingredients: [{ item: 'Pasta', qty: 1, search: 'pasta' }], timesChosen: i }));

// A meal typed in with no ingredients gets a list.
const bare = await h.collection('meals').add({ name: "Shepherd's pie", ingredients: [], timesChosen: 0 });
await fns.newMeal.run({ data: await bare.get(), params: { hid: 'fn-test', mid: bare.id } });
const b = (await bare.get()).data();
assert(b.ingredients.length && b.ingredientsBy === 'claude', 'new meal without ingredients filled in by Claude');

// "Ask Claude for ideas" runs and keeps the picks; a second delivery does nothing.
const week = h.collection('weeks').doc('2026-11-01');
await week.set({ offered: [meals[0].id], picks: { [meals[0].id]: { uid: 'u1' } }, createdAt: FieldValue.serverTimestamp() });
const before = await week.get();
await week.update({ ideasRequested: true });
const change = { data: { before, after: await week.get() }, params: { hid: 'fn-test', wid: week.id } };
await fns.askClaude.run(change);
const d = (await week.get()).data();
assert(d.ideasBy === 'claude' && !d.ideasRequested && d.offered.length >= 9, `Claude ideas made (${d.offered?.length})`);
assert(d.picks[meals[0].id] && d.offered.includes(meals[0].id), 'picks kept');
await fns.askClaude.run(change);
assert((await week.get()).data().offered.length === d.offered.length, 'repeat delivery ignored');

// A recipe link is claimed and handled (example.com has no recipe, so it fails cleanly).
const imp = await h.collection('imports').add({ url: 'https://example.invalid/', state: 'requested', addToWeek: false });
await fns.recipeLink.run({ data: await imp.get(), params: { hid: 'fn-test', iid: imp.id } });
assert((await imp.get()).data().state === 'failed', 'recipe link handled');

// "Get the method": a picked meal with no method gets one written (pretend Claude), once.
const cook = h.collection('meals').doc(meals[1].id);
const cookBefore = await cook.get();
await cook.update({ recipeRequested: true });
await fns.mealRecipe.run({ data: { before: cookBefore, after: await cook.get() }, params: { hid: 'fn-test', mid: cook.id } });
const cooked = (await cook.get()).data();
assert(cooked.recipe?.steps?.length && cooked.recipe.by === 'claude' && !cooked.recipeRequested, 'a meal with no method gets one from Claude');

// A new order starts the GitHub worker at once (GitHub's API is stubbed here).
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }); };
const order = await h.collection('orders').add({ state: 'requested', week: '2026-11-01' });
await fns.startOrder.run({ data: await order.get(), params: { hid: 'fn-test', oid: order.id } });
assert(calls.length === 1 && calls[0].url.endsWith('/actions/workflows/order-worker.yml/dispatches') && JSON.parse(calls[0].init.body).ref === 'main', 'new order dispatches the order worker');
assert((await order.get()).data().workerStartedAt, 'order marked as started');
globalThis.fetch = async () => new Response('Bad credentials', { status: 401 });
const order2 = await h.collection('orders').add({ state: 'requested', week: '2026-11-01' });
await fns.startOrder.run({ data: await order2.get(), params: { hid: 'fn-test', oid: order2.id } });
assert(/didn't start/.test((await order2.get()).data().message || ''), 'a failed dispatch is shown on the order');
globalThis.fetch = realFetch;

// The weekly key check: keeps the worker on and records when its key runs out.
{
  const now = new Date('2026-11-11T06:00:00Z');
  const github = async () => new Response('{}', { status: 200, headers: { 'github-authentication-token-expiration': '2026-11-20 10:00:00 UTC' } });
  const status = await checkWorker(db, github, now);
  const saved = (await h.get()).data().orderHelper;
  assert(status.ok && saved.ok && saved.expires === '2026-11-20', 'the key check records when the GitHub key runs out');
  assert(!(await other.get()).data().orderHelper, 'only allowed households are checked');
  await checkWorker(db, async () => new Response('Bad credentials', { status: 401 }), now);
  assert((await h.get()).data().orderHelper.ok === false, 'a refused key is recorded');
}

// The evening before delivery: an order arriving tomorrow with things on the list is reminded once.
{
  const now = new Date('2026-11-11T18:00:00Z');
  const placed = await h.collection('orders').add({ state: 'placed', deliveryDate: '2026-11-12', week: '2026-11-01' });
  await h.collection('orders').add({ state: 'placed', deliveryDate: '2026-11-12', trial: true });
  await h.collection('list').add({ text: 'Milk', qty: 1, done: false });
  assert(await remindCutoff(db, now) === 1, 'reminder sent for tomorrow\'s delivery');
  assert((await placed.get()).data().reminded, 'the order is marked as reminded');
  assert(await remindCutoff(db, now) === 0, 'and only once');
}

console.log('Functions OK');
process.exit(0);
