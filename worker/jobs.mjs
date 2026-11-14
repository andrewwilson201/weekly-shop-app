// Jobs shared by the GitHub Actions worker (worker/run.mjs) and the Firebase
// functions (functions/index.mjs): meal ideas, recipe links, and filling in
// missing ingredients. Each takes the household's Firestore document.
// The functions get a copy of this folder at deploy time (tools/copy-shared.mjs).

import { FieldValue } from 'firebase-admin/firestore';
import { fetchRecipe, recipeFrom } from './recipe.mjs';
import { claudeIdeas, claudeIngredients, claudeRecipe } from './ideas-claude.mjs';
import { recentRecipes, recipeSources } from './feeds.mjs';
import { pickIdeas, iso, currentPlanId, SKIPS_TO_SUGGEST, learnStaple, recordBought } from '../js/plan.js';

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
async function claimRecipe(ref) {
  return db.runTransaction(async t => {
    const d = await t.get(ref);
    if (d.data()?.recipeRequested !== true) return false;
    t.update(ref, { recipeRequested: 'working' });
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
// wid: the plan (weeks/{wid}). keep: meal ids already picked, which stay in the list.
async function makeIdeas(h, wid, madeBy, keep = []) {
  try { await makeIdeasInner(h, wid, madeBy, keep); }
  catch (e) { await h.ref.collection('weeks').doc(wid).set({ ideasRequested: FieldValue.delete() }, { merge: true }); throw e; }
}
async function makeIdeasInner(h, wid, madeBy, keep) {
  const meals = (await h.ref.collection('meals').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  if (!meals.length) return;
  const ref = h.ref.collection('weeks').doc(wid);
  let offered = null, reasons = {}, by = 'rules';
  // from: meal id -> recipe site, for the ideas that came from Settings › Recipe sites.
  const from = {};
  const featured = await siteRecipes(h, meals, keep);
  try {
    const weeks = (await h.ref.collection('weeks').orderBy('createdAt', 'desc').limit(8).get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(w => w.id !== wid);
    const skipped = (await h.ref.collection('staples').where('skips', '>', 0).get()).docs.map(d => d.data().name);
    const month = new Date().toLocaleDateString('en-GB', { month: 'long', timeZone: 'Europe/London' });
    const ideas = await claudeIdeas({ meals, weeks, skippedStaples: skipped, notes: h.data().notes || '', month, featured });
    if (ideas?.length >= 6) {
      offered = [...keep];
      const b = db.batch();
      for (const i of ideas) {
        let id = i.id;
        if (i.meal) {
          // A recipe from a site: use the page's own ingredient list when it has one.
          if (i.meal.source) Object.assign(i.meal, await fromPage(i.meal.source));
          const doc = h.ref.collection('meals').doc(); id = doc.id;
          // idea: kept out of the meal library until someone picks it.
          b.set(doc, { ...i.meal, idea: true, timesChosen: 0, createdAt: FieldValue.serverTimestamp(), addedBy: { name: 'Claude' } });
        }
        if (!offered.includes(id)) offered.push(id);
        if (i.reason) reasons[id] = i.reason;
        // How long it takes, for the idea cards (a recipe's own time wins).
        if (i.time && !i.meal) { const m = meals.find(x => x.id === id); if (m && !m.time && !m.recipe?.time) b.set(h.ref.collection('meals').doc(id), { time: i.time }, { merge: true }); }
        if (i.from) from[id] = i.from;
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
  await addSiteRecipes(h, featured, offered, keep, reasons, from);
  // A requested refresh keeps the week's picks (the kept meals stay in the list).
  await ref.set({ offered, reasons, from, ...(madeBy === 'request' ? {} : { picks: {}, createdAt: FieldValue.serverTimestamp() }), madeBy, ideasBy: by, ideasRequested: FieldValue.delete() }, { merge: true });
  const b = db.batch();
  for (const id of offered) b.set(h.ref.collection('meals').doc(id), { lastOffered: wid }, { merge: true });
  await b.commit();
  console.log(`Made ${offered.length} ideas for week ${wid} (${by})`);
}

// This week's recipes from the household's recipe sites, leaving out ones
// already in the meal library (offered in an earlier week) unless picked.
// Each site's result is saved on the household for Settings to show.
async function siteRecipes(h, meals, keep) {
  const sources = recipeSources(h.data());
  if (!sources.length) return [];
  try {
    const { recipes, status } = await recentRecipes(sources);
    const at = new Date().toISOString();
    await h.ref.set({ recipeSourceStatus: status.map(s => ({ ...s, at })) }, { merge: true });
    const seen = new Set(meals.filter(m => m.source && !keep.includes(m.id)).map(m => m.source));
    return recipes.filter(r => !seen.has(r.url));
  } catch (e) {
    console.log(`Recipe sites failed: ${e.message}`);
    return [];
  }
}

const readRecipe = url => process.env.RECIPE_FAKE ? fakeRecipe(url) : fetchRecipe(url);
async function fromPage(url) {
  try {
    const r = await readRecipe(url);
    return { ingredients: r.ingredients, ...(r.image ? { image: r.image } : {}), ...(r.servings ? { servings: r.servings } : {}), ...(r.recipe ? { recipe: r.recipe } : {}) };
  } catch (e) {
    console.log(`Couldn't read a site recipe, keeping Claude's ingredients: ${e.message}`);
    return {};
  }
}

// Makes sure each site with new recipes has one in the ideas (Claude may have
// left it out, or the rules made the ideas). Takes the newest page that has
// a recipe on it, and puts it in place of the last idea that isn't a pick.
async function addSiteRecipes(h, featured, offered, keep, reasons, from) {
  const done = new Set(Object.values(from));
  for (const site of new Set(featured.map(f => f.source))) {
    if (done.has(site)) continue;
    for (const f of featured.filter(x => x.source === site).slice(0, 3)) {
      let r;
      try { r = await readRecipe(f.url); } catch (e) { console.log(`Site recipe skipped: ${e.message}`); continue; }
      const doc = h.ref.collection('meals').doc();
      await doc.set({ name: r.name || f.title, ingredients: r.ingredients, source: f.url, image: r.image || null, servings: r.servings || null, ...(r.recipe ? { recipe: r.recipe } : {}), idea: true, timesChosen: 0, createdAt: FieldValue.serverTimestamp(), addedBy: { name: site } });
      let at = -1;
      for (let k = offered.length - 1; k >= keep.length; k--) if (!from[offered[k]] && !keep.includes(offered[k])) { at = k; break; }
      if (offered.length >= 10 + keep.length && at >= 0) offered[at] = doc.id; else offered.push(doc.id);
      from[doc.id] = site;
      reasons[doc.id] = `New on ${site} this week.`;
      break;
    }
  }
}

// Reads the recipe at the link and saves it as a meal. If asked, also adds it
// to this week's ideas and picks it for whoever shared the link.
async function processImport({ h, ref, data }) {
  try {
    const r = await (process.env.RECIPE_FAKE ? fakeRecipe(data.url) : fetchRecipe(data.url));
    const meal = h.ref.collection('meals').doc();
    await meal.set({ name: r.name || 'Recipe from a link', ingredients: r.ingredients, source: data.url, image: r.image || null, servings: r.servings || null, ...(r.recipe ? { recipe: r.recipe } : {}), timesChosen: 0, createdAt: FieldValue.serverTimestamp(), addedBy: data.by || null });
    if (data.addToWeek) {
      // The plan being worked on (the newest one not yet ordered), as the app works it out.
      const weeks = Object.fromEntries((await h.ref.collection('weeks').orderBy('createdAt', 'desc').limit(8).get()).docs.map(d => [d.id, d.data()]));
      const week = h.ref.collection('weeks').doc(currentPlanId(weeks, iso(new Date())));
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
  return { ...r, ingredients: r.ingredients.map(parseIngredient), recipe: recipeFrom(r) };
}

// A meal someone wants to cook (picked, or opened on Recipes) with no method
// saved: read its recipe page again if it has one (meals added before methods
// were kept, or ones whose page Claude suggested), otherwise Claude writes one.
// Asked for by setting recipeRequested on the meal; tried once each time.
async function fillRecipe(h, ref) {
  if (!(await claimRecipe(ref))) return;
  const m = (await ref.get()).data();
  try {
    let recipe = null;
    if (/^https?:\/\//.test(m.source || '')) {
      try { recipe = (await readRecipe(m.source)).recipe; }
      catch (e) { console.log(`Couldn't read the recipe page again: ${e.message}`); }
    }
    if (!recipe) recipe = await claudeRecipe(m, h.data().notes || '');
    await ref.update(recipe
      ? { recipe, recipeRequested: FieldValue.delete(), recipeMessage: FieldValue.delete() }
      : { recipeRequested: FieldValue.delete(), recipeMessage: 'No method could be found for this one.' });
    console.log(recipe ? `Saved a recipe (${recipe.by})` : 'No recipe found');
  } catch (e) {
    await ref.update({ recipeRequested: FieldValue.delete(), recipeMessage: 'Couldn\'t get the method just now. Try again in a bit.' });
    console.log(`Recipe failed: ${e.message}`);
  }
}

// Meals with no ingredient list (typed in, or from the order history) get one
// from Claude, so picking them adds the right things to the shop. Each meal is
// tried once; a person can still edit the list afterwards.
async function fillIngredients(h, only = null) {
  const snap = only ? [await only.get()] : (await h.ref.collection('meals').get()).docs;
  const todo = snap.filter(d => d.exists && !(d.data().ingredients || []).length && !d.data().ingredientsTried && !d.data().archived)
    .map(d => ({ id: d.id, name: d.data().name }));
  // Dinners typed on Next shop ask for the method once their ingredients are in
  // (the method is written to match the shopping list): see js/views/week.js.
  const after = new Set(snap.filter(d => d.exists && d.data().recipeAfter).map(d => d.id));
  const serves = Number(h.data().serves) || 4;
  for (let i = 0; i < todo.length; i += 15) {
    const chunk = todo.slice(i, i + 15);
    let lists = null;
    try { lists = await claudeIngredients(chunk, h.data().notes || '', serves); }
    catch (e) { console.log(`Claude ingredients failed: ${e.message}`); }
    if (!lists) return; // no API key, or it failed: try again next time
    const b = db.batch();
    for (const m of chunk) {
      const ingredients = lists[m.id] || [];
      const recipe = after.has(m.id) ? { recipeAfter: FieldValue.delete(), ...(ingredients.length ? { recipeRequested: true } : {}) } : {};
      b.set(h.ref.collection('meals').doc(m.id), { ingredientsTried: true, ...(ingredients.length ? { ingredients, ingredientsBy: 'claude' } : {}), ...recipe }, { merge: true });
    }
    await b.commit();
    console.log(`Filled in ingredients for ${chunk.length} meal(s)`);
  }
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
    const was = l.swap?.fromUid || l.uid;
    const id = l.source === 'staple' ? l.key.slice(7) : was && staples.has(String(was)) ? String(was) : null;
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
    // A cheaper swap doesn't replace the usual: it's checked again each week.
    mealPicks.get(id).set(item, l.swap ? { uid: l.swap.fromUid, product: l.swap.from } : { uid: l.uid, product: l.product });
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
  for (const l of lines) if (l.result === 'added' && l.uid) products = l.swap ? recordBought(products, l.swap.fromUid, l.swap.from, delivery) : recordBought(products, l.uid, l.product || l.name, delivery);
  b.set(pref, { items: products }, { merge: true });
  await b.commit();
}

// "I finished it in the Sainsbury's app": the helper stopped (the bank wanted
// a check, nobody approved in time, the basket was under the minimum...) and
// someone checked out in the Sainsbury's app instead. The app writes
// finishedElsewhere; this marks the order placed and does the same tidy-up as
// a placed order. It never talks to Sainsbury's, so it can't order or pay twice.
// Both the function and the worker may see it; the transaction lets one do it.
async function finishElsewhere(h, ref) {
  const order = await db.runTransaction(async t => {
    const d = (await t.get(ref)).data();
    if (!d?.finishedElsewhere || d.state !== 'needs_you' || d.trial) return null;
    t.update(ref, { state: 'placed', placedAt: FieldValue.serverTimestamp(), stoppedAt: FieldValue.delete(), message: FieldValue.delete(), log: FieldValue.arrayUnion(`Finished in the Sainsbury's app (said ${d.finishedElsewhere.name || 'someone'})`) });
    return d;
  });
  if (!order) return false;
  const delivery = (order.slot?.start_time ? londonDay(order.slot.start_time) : '') || order.deliveryDate;
  try {
    if (order.amend?.of) await h.ref.collection('orders').doc(order.amend.of).set({ amendedBy: FieldValue.arrayUnion({ id: ref.id, at: new Date(), by: order.finishedElsewhere.name || '' }) }, { merge: true });
    await afterPlaced(h, order, order.lines || [], delivery);
  } catch (e) {
    console.error(`Tidy-up after an order finished elsewhere: ${e.message}`);
    await ref.update({ message: 'Marked as ordered. Updating staples, meals and the list didn\'t finish, so check the list before the next shop.' }).catch(() => {});
  }
  return true;
}
const londonDay = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

return { claimImport, claimIdeas, makeIdeas, processImport, fakeRecipe, fillIngredients, fillRecipe, afterPlaced, finishElsewhere };
}
