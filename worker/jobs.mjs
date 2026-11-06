// Jobs shared by the GitHub Actions worker (worker/run.mjs) and the Firebase
// functions (functions/index.mjs): meal ideas, recipe links, and filling in
// missing ingredients. Each takes the household's Firestore document.
// The functions get a copy of this folder at deploy time (tools/copy-shared.mjs).

import { FieldValue } from 'firebase-admin/firestore';
import { fetchRecipe } from './recipe.mjs';
import { claudeIdeas, claudeIngredients } from './ideas-claude.mjs';
import { pickIdeas, weekId, iso } from '../js/plan.js';

export function makeJobs(db) {

// Both the function and the worker may see the same request; whoever flips it first does it.
async function claimImport(ref) {
  return db.runTransaction(async t => {
    const d = await t.get(ref);
    if (d.data()?.state !== 'requested') return false;
    t.update(ref, { state: 'reading' });
    return true;
  });
}
async function claimIdeas(ref) {
  return db.runTransaction(async t => {
    const d = await t.get(ref);
    if (d.data()?.ideasRequested !== true) return false;
    t.update(ref, { ideasRequested: 'working' });
    return true;
  });
}

// Claude chooses when there's an API key; otherwise (or if it fails) the rules do.
// keep: meal ids already picked this week, which stay in the list.
async function makeIdeas(h, sunday, madeBy, keep = []) {
  try { await makeIdeasInner(h, sunday, madeBy, keep); }
  catch (e) { await h.ref.collection('weeks').doc(sunday).set({ ideasRequested: FieldValue.delete() }, { merge: true }); throw e; }
}
async function makeIdeasInner(h, sunday, madeBy, keep) {
  const meals = (await h.ref.collection('meals').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  if (!meals.length) return;
  const ref = h.ref.collection('weeks').doc(sunday);
  let offered = null, reasons = {}, by = 'rules';
  try {
    const weeks = (await h.ref.collection('weeks').orderBy('createdAt', 'desc').limit(8).get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(w => w.id !== sunday);
    const skipped = (await h.ref.collection('staples').where('skips', '>', 0).get()).docs.map(d => d.data().name);
    const month = new Date().toLocaleDateString('en-GB', { month: 'long', timeZone: 'Europe/London' });
    const ideas = await claudeIdeas({ meals, weeks, skippedStaples: skipped, notes: h.data().notes || '', season: `${month}, UK` });
    if (ideas?.length >= 6) {
      offered = [...keep];
      const b = db.batch();
      for (const i of ideas) {
        let id = i.id;
        if (i.meal) { const doc = h.ref.collection('meals').doc(); id = doc.id; b.set(doc, { ...i.meal, timesChosen: 0, createdAt: FieldValue.serverTimestamp(), addedBy: { name: 'Claude' } }); }
        if (!offered.includes(id)) offered.push(id);
        if (i.reason) reasons[id] = i.reason;
      }
      await b.commit();
      // Any the variety check dropped are topped up from the usual picks.
      if (offered.length < 10 + keep.length) offered.push(...pickIdeas(meals.filter(m => !offered.includes(m.id)), { count: 10 + keep.length - offered.length, today: iso(new Date()) }));
      offered = offered.slice(0, 10 + keep.length);
      by = 'claude';
    }
  } catch (e) {
    console.log(`Claude ideas failed, using the rules instead: ${e.message}`);
  }
  if (!offered) offered = [...keep, ...pickIdeas(meals.filter(m => !keep.includes(m.id)), { count: 10 - keep.length, today: iso(new Date()) })];
  // A requested refresh keeps the week's picks (the kept meals stay in the list).
  await ref.set({ offered, reasons, ...(madeBy === 'request' ? {} : { picks: {}, createdAt: FieldValue.serverTimestamp() }), madeBy, ideasBy: by, ideasRequested: FieldValue.delete() }, { merge: true });
  const b = db.batch();
  for (const id of offered) b.set(h.ref.collection('meals').doc(id), { lastOffered: sunday }, { merge: true });
  await b.commit();
  console.log(`Made ${offered.length} ideas for week ${sunday} (${by})`);
}

// Reads the recipe at the link and saves it as a meal. If asked, also adds it
// to this week's ideas and picks it for whoever shared the link.
async function processImport({ h, ref, data }) {
  try {
    const r = await (process.env.RECIPE_FAKE ? fakeRecipe(data.url) : fetchRecipe(data.url));
    const meal = h.ref.collection('meals').doc();
    await meal.set({ name: r.name || 'Recipe from a link', ingredients: r.ingredients, source: data.url, image: r.image || null, servings: r.servings || null, timesChosen: 0, createdAt: FieldValue.serverTimestamp(), addedBy: data.by || null });
    if (data.addToWeek) {
      const week = h.ref.collection('weeks').doc(weekId(new Date()));
      const update = { offered: FieldValue.arrayUnion(meal.id), createdAt: FieldValue.serverTimestamp() };
      if (data.by?.uid) update.picks = { [meal.id]: data.by };
      // Keep an existing week's createdAt.
      if ((await week.get()).exists) delete update.createdAt;
      await week.set(update, { merge: true });
    }
    await ref.update({ state: 'done', mealId: meal.id, name: r.name, count: r.ingredients.length, doneAt: FieldValue.serverTimestamp() });
    console.log(`Imported a recipe (${r.ingredients.length} ingredients)`);
  } catch (e) {
    await ref.update({ state: 'failed', message: e.message || String(e) });
    console.log(`Recipe import failed: ${e.message}`);
  }
}

async function fakeRecipe(url) {
  const { extractRecipe, parseIngredient } = await import('./recipe.mjs');
  const html = (await import('node:fs')).readFileSync(new URL('../test/fixtures/recipe.html', import.meta.url), 'utf8');
  const r = extractRecipe(html, url);
  return { ...r, ingredients: r.ingredients.map(parseIngredient) };
}

// Meals with no ingredient list (typed in, or from the order history) get one
// from Claude, so picking them adds the right things to the shop. Each meal is
// tried once; a person can still edit the list afterwards.
async function fillIngredients(h, only = null) {
  const snap = only ? [await only.get()] : (await h.ref.collection('meals').get()).docs;
  const todo = snap.filter(d => d.exists && !(d.data().ingredients || []).length && !d.data().ingredientsTried && !d.data().archived)
    .map(d => ({ id: d.id, name: d.data().name }));
  for (let i = 0; i < todo.length; i += 15) {
    const chunk = todo.slice(i, i + 15);
    let lists = null;
    try { lists = await claudeIngredients(chunk, h.data().notes || ''); }
    catch (e) { console.log(`Claude ingredients failed: ${e.message}`); }
    if (!lists) return; // no API key, or it failed: try again next time
    const b = db.batch();
    for (const m of chunk) {
      const ingredients = lists[m.id] || [];
      b.set(h.ref.collection('meals').doc(m.id), { ingredientsTried: true, ...(ingredients.length ? { ingredients, ingredientsBy: 'claude' } : {}) }, { merge: true });
    }
    await b.commit();
    console.log(`Filled in ingredients for ${chunk.length} meal(s)`);
  }
}

return { claimImport, claimIdeas, makeIdeas, processImport, fakeRecipe, fillIngredients };
}
