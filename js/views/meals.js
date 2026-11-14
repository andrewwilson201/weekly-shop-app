// Meals: the household's dinners, recipe links, and the meal editor.
import * as S from '../store.js?v=11';
import { isIdea } from '../plan.js?v=11';
import { icon, tile, MEAL_CATEGORIES, mealCategory, autoCategory, categoryTile } from '../ui.js?v=11';
import { st, esc, fmtDay, plural, head, section, empty, run, render, keep, resetKeep, arg, openCats, routes, actions, hooks } from '../core.js?v=11';
import { mealById, plan, savePlan } from '../state.js?v=11';

export const libTabs = now => `<div class="seg" role="tablist">${[['meals', 'Meals'], ['staples', 'Staples']].map(([r, l]) => `<a href="#/${r}" role="tab" class="${r === now ? 'on' : ''}" aria-selected="${r === now}">${l}</a>`).join('')}</div>`;
routes.meals = () => {
  // Ideas nobody has picked aren't part of the library (see isIdea); they're listed under "Ideas you didn't pick".
  const pickedEver = new Set(Object.values(st.weeks).flatMap(w => Object.keys(w.picks || {})));
  const ideaOnly = m => isIdea(m) && !pickedEver.has(m.id);
  const meals = [...st.meals].filter(m => !m.archived && !ideaOnly(m)).sort((a, b) => (b.timesChosen || 0) - (a.timesChosen || 0) || a.name.localeCompare(b.name));
  let html = libTabs('meals') + head('Meals', { sub: 'Your dinners. Each shop\'s ideas are picked from these and from Claude.', right: `<a class="btn small tonal" href="#/meal/new">${icon('plus')} New</a>` });
  html += `<form class="card" data-form="importLink"><h3 style="display:flex;gap:8px;align-items:center">${icon('link')} Add a recipe from a link</h3>
      <p class="small muted" style="margin:4px 0 12px">Paste a recipe page, or share it to Weekly Shop from your phone. The ingredients are added for you.</p>
      <div class="inputrow"><input type="url" name="url" data-keep="importUrl" placeholder="https://www.bbcgoodfood.com/recipes/…" inputmode="url" autocomplete="off" required aria-label="Recipe link"><button class="btn primary">Add recipe</button></div>
      <label class="row small" style="margin-top:12px;gap:10px"><input type="checkbox" name="week" class="check" checked> Pick it for the next shop</label></form>
    ${importsHtml()}`;
  if (!meals.length) return html + `<div class="card">${empty('bowl', 'No meals yet', 'Load a starter set of family dinners, or add your own.', '<button class="btn primary" data-act="loadStarter">Load starter meals</button>')}</div>`;
  const inWeek = new Set(plan()?.offered || []);
  html += section('All meals', { count: meals.length });
  html += `<div class="search" style="margin-bottom:10px">${icon('search')}<input type="search" placeholder="Search meals" data-keep="mealSearch" data-filter="mealList" aria-label="Search meals"></div>`;
  // Grouped by category, each collapsed until tapped, so a long list stays short.
  const row = m => `<li class="link-row" data-name="${esc(m.name.toLowerCase())}">${tile(m, 'sm')}<a href="#/meal/${m.id}" class="grow">
      <span class="name">${esc(m.name)}</span><span class="meta">${plural((m.ingredients || []).length, 'ingredient')}${m.ingredientsBy === 'claude' ? ' (from Claude)' : ''}${m.timesChosen ? ` · picked ${m.timesChosen}×` : ''}${m.lastChosen ? `, last ${fmtDay(m.lastChosen)}` : ''}</span></a>
      ${!inWeek.has(m.id) ? `<button class="btn small outline" data-act="offer" data-id="${m.id}">Add to next shop</button>` : '<span class="pill ok">In the next shop\'s ideas</span>'}</li>`;
  html += `<div id="mealList" class="cat-list">`;
  for (const [key, label] of MEAL_CATEGORIES) {
    const g = meals.filter(m => mealCategory(m) === key);
    if (!g.length) continue;
    html += `<details class="card flush disclosure cat" data-group="${key}" data-cat="${key}"${openCats.has(key) ? ' open' : ''}>
      <summary>${categoryTile(key, 'sm')}<span class="grow">${label}</span><span class="count">${g.length}</span></summary>
      <ul class="list">${g.map(row).join('')}</ul></details>`;
  }
  html += `</div>`;
  const pastIdeas = st.meals.filter(m => !m.archived && ideaOnly(m) && !inWeek.has(m.id)).sort((a, b) => String(b.lastOffered || '').localeCompare(String(a.lastOffered || '')));
  if (pastIdeas.length) html += `<details class="card flush disclosure" style="margin-top:12px" data-toggle="pastIdeas" ${keep.pastIdeas ? 'open' : ''}><summary>${icon('sparkle')} Ideas you didn't pick <span class="count">${pastIdeas.length}</span></summary>
    <p class="small muted" style="margin:0;padding:0 16px 8px">Suggested by Claude or your recipe sites. They join your meals once picked, or add one now.</p><ul class="list">${pastIdeas.map(m => `<li>${tile(m, 'sm')}<a href="#/recipe/${esc(m.id)}" class="grow"><span class="name">${esc(m.name)}</span><span class="meta">${esc(m.addedBy?.name ? `From ${m.addedBy.name}` : 'Idea')}${m.lastOffered ? ` · offered ${fmtDay(m.lastOffered, { day: 'numeric', month: 'short' })}` : ''}</span></a>
    <button class="btn small outline" data-act="keepIdea" data-id="${esc(m.id)}">Add to meals</button></li>`).join('')}</ul></details>`;
  const archived = st.meals.filter(m => m.archived);
  if (archived.length) html += `<details class="card flush disclosure" style="margin-top:12px"><summary>Removed meals <span class="count">${archived.length}</span></summary><ul class="list">${archived.map(m => `<li><span class="grow">${esc(m.name)}</span><button class="btn small outline" data-act="unarchive" data-id="${m.id}">Restore</button></li>`).join('')}</ul></details>`;
  return html;
};
function importsHtml() {
  const recent = st.imports.filter(i => i.state !== 'done' || (i.doneAt && Date.now() - i.doneAt.toMillis() < 864e5)).slice(0, 5);
  if (!recent.length) return '';
  return `<div class="card flush"><ul class="list">` + recent.map(i => `<li>${i.state === 'requested' || i.state === 'reading' ? '<span class="spinner" style="flex:none"></span>' : i.state === 'failed' ? `<span class="tile sm meat">${icon('alert')}</span>` : `<span class="tile sm veg">${icon('check')}</span>`}
    <span class="grow"><span class="name">${esc(i.name || i.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</span>
    <span class="meta">${i.state === 'requested' || i.state === 'reading' ? 'Reading the recipe…' : i.state === 'failed' ? esc(i.message || 'Couldn\'t read it') : `${i.count} ingredients added${i.addToWeek ? ', picked for the next shop' : ''}`}</span></span>
    ${i.state === 'done' && i.mealId ? `<a class="btn small tonal" href="#/meal/${i.mealId}">Check it</a>` : ''}
    ${i.state !== 'requested' ? `<button class="iconbtn sm" data-act="dismissImport" data-id="${i.id}" aria-label="Dismiss">${icon('x')}</button>` : ''}</li>`).join('') + `</ul></div>`;
}
async function importLink(url, addToWeek = true) {
  url = String(url).trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('That doesn\'t look like a web link');
  await S.addH(['imports'], { url, addToWeek, by: S.me(), state: 'requested', createdAt: S.serverTimestamp() });
}
actions.importLink = f => { const url = f.url.value; const wk = f.week.checked; keep.importUrl = ''; run(() => importLink(url, wk), 'Got it. It\'ll appear in a moment'); };
actions.dismissImport = el => run(() => S.deleteH(['imports', el.dataset.id]));
// Links shared to the app (Web Share Target in manifest.json): ?url=…&text=…&title=…
let sharedLink = (() => {
  const q = new URLSearchParams(location.search);
  if (!q.has('url') && !q.has('text')) return null;
  const found = [q.get('url'), q.get('text'), q.get('title')].join(' ').match(/https?:\/\/\S+/);
  history.replaceState(null, '', location.pathname + '#/meals');
  return found ? found[0] : null;
})();
hooks.rendered.push(function takeSharedLink() {
  if (!sharedLink || !st.household?.members) return;
  const url = sharedLink; sharedLink = null;
  run(() => importLink(url, true), 'Recipe link added. It\'ll appear in a moment');
});

actions.offer = el => run(() => savePlan({ offered: [...(plan()?.offered || []), el.dataset.id] }), 'Added to the next shop\'s ideas');
actions.keepIdea = el => run(() => S.updateH(['meals', el.dataset.id], { idea: false }), 'Added to your meals');
actions.unarchive = el => run(() => S.updateH(['meals', el.dataset.id], { archived: false }));


// The meal editor: one row per ingredient, with how many, whether it's
// usually in the cupboard (left out of the shop unless ticked) and, folded
// away, the words to search Sainsbury's for. The rows being edited are kept
// in keep.mealDraft until saved, so live updates don't wipe them.
function draft(m) {
  if (keep.mealDraft?.id !== arg) keep.mealDraft = { id: arg, ings: (m.ingredients || []).map(i => ({ ...i, was: i.item })) };
  const d = keep.mealDraft;
  // Typed text lives in keep under the row's inputs (data-keep) until now.
  d.ings.forEach((g, i) => {
    for (const f of ['item', 'search']) { const k = `ing:${i}:${f}`; if (keep[k] != null) { g[f] = keep[k]; delete keep[k]; } }
  });
  return d;
}
const plainSearch = g => !g.search || [g.item.toLowerCase(), `sainsburys ${g.item.toLowerCase()}`].includes(String(g.search).toLowerCase());
routes.meal = () => {
  const m = arg === 'new' ? { name: '', ingredients: [] } : mealById(arg);
  if (!m) return empty('bowl', 'Meal not found', 'It may have been removed.', '<a class="btn" href="#/meals">Back to meals</a>');
  const d = draft(m);
  const rows = d.ings.map((g, i) => `<li class="ing-row">
      <div class="row nowrap"><input type="text" value="${esc(g.item)}" data-keep="ing:${i}:item" placeholder="e.g. Chicken thighs" aria-label="Ingredient ${i + 1}" autocomplete="off">
      <button type="button" class="iconbtn sm" data-act="ingDel" data-id="${i}" aria-label="Remove ${esc(g.item || 'this ingredient')}">${icon('x')}</button></div>
      <div class="row ing-more"><span class="stepper"><button type="button" class="step" data-act="ingQty" data-id="${i}" data-q="-1" aria-label="One fewer">${icon('minus')}</button><b aria-label="How many">${g.qty || 1}</b><button type="button" class="step" data-act="ingQty" data-id="${i}" data-q="1" aria-label="One more">${icon('plus')}</button></span>
      <label class="row small nowrap" style="gap:8px"><input type="checkbox" class="check" data-change="ingPantry" data-id="${i}" ${g.pantry ? 'checked' : ''}> In the cupboard</label>
      <details class="mini" data-toggle="ingx:${i}" ${keep[`ingx:${i}`] || !plainSearch(g) ? 'open' : ''}><summary>Exact product</summary>
        <input type="text" value="${esc(plainSearch(g) ? '' : g.search)}" data-keep="ing:${i}:search" placeholder="Sainsbury's search words" aria-label="Search words for ${esc(g.item)}" autocomplete="off"></details></div></li>`).join('');
  return `<a class="btn small ghost" href="#/meals" style="margin:8px 0 0 -6px">${icon('back')} Meals</a>
    ${head(arg === 'new' ? 'Add a meal' : 'Edit meal', { right: arg === 'new' ? '' : tile(m) })}
    <form class="card" data-form="saveMeal">
      <label class="field">Name<input type="text" name="name" value="${esc(m.name)}" required data-keep="mealName"></label>
      ${m.source ? `<p class="small muted">${icon('link')} From <a href="${esc(m.source)}" target="_blank" rel="noopener">${esc(m.source.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a></p>` : ''}
      ${arg === 'new' ? '' : `<p class="small"><a href="#/recipe/${esc(m.id)}">${icon('book')} View the recipe and method</a></p>`}
      <label class="field">Category<select name="category" data-keep="mealCat">
        <option value="">Automatic${m.name ? ` (${MEAL_CATEGORIES.find(c => c[0] === autoCategory(m))[1]})` : ''}</option>
        ${MEAL_CATEGORIES.map(([k, l]) => `<option value="${k}"${m.category === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="field"><span>Ingredients for the shop <span class="count">${d.ings.length}</span></span><span class="hint">Cupboard things (oil, salt, stock) are only bought when you tick them on the Basket screen.</span></div>
      <ul class="list ing-list">${rows}</ul>
      <button type="button" class="btn tonal block" data-act="ingAdd" style="margin:10px 0 16px">${icon('plus')} Add ingredient</button>
      ${m.ingredientsBy === 'claude' ? `<p class="small muted">${icon('sparkle')} Ingredients suggested by Claude. Check them over.</p>` : ''}
      <div class="row nowrap"><button class="btn primary lg" style="flex:1">Save</button>
      ${arg === 'new' ? '' : '<button type="button" class="btn lg outline danger" data-act="archiveMeal">Remove</button>'}</div>
    </form>`;
};
// The old rows go before re-rendering, so their inputs aren't read back into the wrong rows.
const editDraft = fn => { const m = arg === 'new' ? { ingredients: [] } : mealById(arg); if (!m) return; fn(draft(m).ings); document.querySelectorAll('.ing-row').forEach(r => r.remove()); render(); };
actions.ingQty = el => editDraft(ings => { const g = ings[+el.dataset.id]; g.qty = Math.max(1, Math.min(20, (g.qty || 1) + Number(el.dataset.q))); });
actions.ingPantry = el => editDraft(ings => { ings[+el.dataset.id].pantry = el.checked; });
actions.ingAdd = () => {
  editDraft(ings => ings.push({ item: '', qty: 1 }));
  const inputs = document.querySelectorAll('.ing-row input[type=text][data-keep$=":item"]');
  inputs[inputs.length - 1]?.focus();
};
actions.ingDel = el => editDraft(ings => {
  const i = +el.dataset.id;
  ings.splice(i, 1);
  // The folded "exact product" rows move up with their ingredient.
  for (let j = i; j <= ings.length; j++) { if (keep[`ingx:${j + 1}`] != null) keep[`ingx:${j}`] = keep[`ingx:${j + 1}`]; else delete keep[`ingx:${j}`]; }
});
actions.saveMeal = f => {
  const m = arg === 'new' ? { ingredients: [] } : mealById(arg);
  const ingredients = draft(m).ings.map(g => ({ ...g, item: String(g.item || '').trim() })).filter(g => g.item).map(({ was, ...g }) => {
    const search = String(g.search || '').trim();
    const out = { ...g, qty: g.qty || 1, search: search && !plainSearch({ item: g.item, search }) ? search : g.item };
    if (!out.pantry) delete out.pantry;
    // A renamed ingredient or new search words: the remembered product no longer applies.
    const orig = (mealById(arg)?.ingredients || []).find(x => x.item === was);
    if (!orig || was !== g.item || out.search !== (plainSearch(orig) ? orig.item : orig.search)) { delete out.uid; delete out.product; }
    return out;
  });
  const data = { name: f.name.value.trim(), ingredients };
  const category = f.category.value;
  resetKeep();
  run(async () => {
    if (arg === 'new') await S.addH(['meals'], { ...data, ...(category ? { category } : {}), timesChosen: 0, createdAt: S.serverTimestamp() });
    else await S.updateH(['meals', arg], { ...data, category: category || S.deleteField() });
    location.hash = '#/meals';
  }, 'Saved');
};
actions.archiveMeal = () => run(async () => { await S.updateH(['meals', arg], { archived: true }); location.hash = '#/meals'; });
