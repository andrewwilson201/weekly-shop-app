// Runs the Firebase function handlers against the Firestore emulator, with a
// pretend Claude (the functions emulator can't register triggers in this sandbox):
//   firebase emulators:start --only firestore
//   node test/functions-check.mjs
process.env.FIRESTORE_EMULATOR_HOST ||= 'localhost:8081';
process.env.GCLOUD_PROJECT = 'weekly-shop-177b1';
process.env.CLAUDE_FAKE = '1';
process.env.ANTHROPIC_API_KEY = 'fake';
const fns = await import('../functions/index.mjs');
const { getFirestore, FieldValue } = await import('../functions/node_modules/firebase-admin/lib/firestore/index.js');
const db = getFirestore();
const assert = (c, m) => { if (!c) throw new Error(`FAILED: ${m}`); console.log(`ok - ${m}`); };

const h = db.collection('households').doc('fn-test');
await h.set({ members: ['u1'], name: 'Test', inviteCode: 'abcdefghijk' });
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
console.log('Functions OK');
process.exit(0);
