// Recipes: the dinners shopped for, and each one's recipe to cook from.
import * as S from '../store.js?v=11';
import { servesNumber, scaleFor, scaleLine, planDate } from '../plan.js?v=11';
import { icon, tile } from '../ui.js?v=11';
import { esc, fmtDay, today, head, section, empty, run, toast, render, hostOf, keep, route, arg, routes, actions, hooks } from '../core.js?v=11';
import { mealById, planId, cookList, hasMethod, askRecipe, householdServes } from '../state.js?v=11';

// Each shop's dinners are headed by when it arrives.
const weekName = (wid, x) => wid === planId() ? 'Next shop' : x?.delivery ? `Shop for ${fmtDay(x.delivery)}` : `Shop started ${fmtDay(planDate(wid))}`;
function deliveryNote(x) {
  if (!x.ordered) return x.week === planId() ? 'Not ordered yet' : 'Ordered';
  if (!x.delivery) return 'Ordered';
  return x.delivery <= today() ? `Delivered ${fmtDay(x.delivery)}` : `Arriving ${fmtDay(x.delivery)}`;
}
function recipeMeta(m) {
  const bits = [];
  if (m.recipe?.time || m.time) bits.push(m.recipe?.time || m.time);
  if (hasMethod(m)) bits.push(m.recipe.by === 'claude' ? 'Method by Claude' : `From ${hostOf(m.source || '') || 'the recipe page'}`);
  else if (m.recipeRequested) bits.push('Getting the method…');
  else if (m.source) bits.push(`Recipe on ${hostOf(m.source)}`);
  return bits.join(' · ');
}
routes.cook = () => {
  const all = cookList();
  const todo = all.filter(x => !x.done);
  let html = head('Recipes', { eyebrow: 'To cook', sub: 'The dinners you\'ve shopped for, with their recipes. Each stays here until you mark it cooked, even after the next shop.' });
  if (!todo.length) {
    html += `<div class="card">${empty('book', all.length ? 'All cooked' : 'Nothing to cook yet', all.length ? 'Everything you shopped for is done. The next shop\'s dinners appear here once you pick them.' : 'Pick dinners for the next shop and they\'ll show here with their recipes.', '<a class="btn primary" href="#/week">Next shop</a>')}</div>`;
  }
  const weeks = [...new Set(todo.map(x => x.week))];
  for (const wid of weeks) {
    const rows = todo.filter(x => x.week === wid);
    const past = wid !== planId();
    html += section(weekName(wid, rows[0]), { count: rows.length, right: `<span class="small muted">${esc(deliveryNote(rows[0]))}</span>` });
    html += `<div class="card flush"><ul class="list">` + rows.map(x => {
      const m = mealById(x.mealId);
      return `<li class="link-row">${tile(m, 'sm')}<a href="#/recipe/${esc(m.id)}" class="grow"><span class="name">${esc(m.name)}</span><span class="meta">${esc(recipeMeta(m))}</span></a>
        <button class="btn small outline" data-act="cooked" data-id="${esc(wid)}|${esc(m.id)}" aria-label="Mark ${esc(m.name)} cooked">${icon('check')} Cooked</button></li>`;
    }).join('') + `</ul></div>`;
    if (past && rows.length > 1) html += `<p class="small muted" style="margin:-4px 4px 0;text-align:right"><button class="link" data-act="notCookingWeek" data-id="${esc(wid)}">Not making the rest</button></p>`;
  }
  const done = all.filter(x => x.done).sort((a, b) => String(b.done.on).localeCompare(String(a.done.on))).slice(0, 10);
  if (done.length) {
    html += `<details class="card flush disclosure" style="margin-top:16px" ${keep.cookedOpen ? 'open' : ''} data-toggle="cookedOpen"><summary>${icon('check')} Done lately <span class="count">${done.length}</span></summary><ul class="list">` + done.map(x => {
      const m = mealById(x.mealId);
      const v = x.done.verdict;
      return `<li>${tile(m, 'sm')}<a href="#/recipe/${esc(m.id)}" class="grow"><span class="name">${esc(m.name)}</span><span class="meta">${x.done.skipped ? 'Not making it' : `Cooked ${fmtDay(x.done.on)}`}${x.done.by?.name ? ` · ${esc(x.done.by.name.split(' ')[0])}` : ''}${v ? ` · ${v.again ? 'Would make again' : 'Wouldn\'t make again'}` : ''}</span></a>
        ${!x.done.skipped && !v ? verdictButtons(x.week, m.id, true) : `<button class="btn small ghost" data-act="uncook" data-id="${esc(x.week)}|${esc(m.id)}">Undo</button>`}</li>`;
    }).join('') + `</ul></details>`;
  }
  // Methods for anything on the list that hasn't got one yet.
  queueMicrotask(() => todo.forEach(x => { const m = mealById(x.mealId); if (!m.recipeMessage) askRecipe(m); }));
  return html;
};
const markCooked = (wid, id, extra = {}) => S.updateH(['weeks', wid], { [`cooked.${id}`]: { by: S.me(), on: today(), ...extra } });
actions.cooked = el => { const [wid, id] = el.dataset.id.split('|'); run(() => markCooked(wid, id), `${mealById(id)?.name || 'Dinner'} marked cooked. Would you make it again?`); };
// "Would you make it again?" after cooking: saved on the week's cooked entry and
// on the meal (verdicts), which Claude reads when it picks ideas. A "no" stops
// the dinner being suggested again; a note ("too spicy for the kids") guides Claude.
function verdictButtons(wid, id, small = false, label = !small) {
  const d = `${esc(wid)}|${esc(id)}`;
  return `<span class="verdict${small ? ' sm' : ''}">${label ? '<span class="small muted">Would you make it again?</span>' : ''}<button class="btn small outline" data-act="verdict" data-id="${d}" data-v="yes" aria-label="Would make it again">${icon('thumbUp')}${small ? '' : ' Yes'}</button><button class="btn small outline" data-act="verdict" data-id="${d}" data-v="no" aria-label="Wouldn't make it again">${icon('thumbDown')}${small ? '' : ' No'}</button></span>`;
}
actions.verdict = el => {
  const [wid, id] = el.dataset.id.split('|');
  const again = el.dataset.v === 'yes';
  const note = (prompt(again ? 'Any note for next time? (optional)' : 'What wasn\'t right? (optional, e.g. too spicy for the kids)') || '').trim().slice(0, 200);
  const v = { again, by: S.me(), on: today(), ...(note ? { note } : {}) };
  run(async () => {
    await S.updateH(['weeks', wid], { [`cooked.${id}.verdict`]: v });
    await S.updateH(['meals', id], { verdicts: S.arrayUnion(v) });
  }, again ? 'Noted: one to make again' : 'Noted: it won\'t be suggested again');
};
actions.notCooking = el => { const [wid, id] = el.dataset.id.split('|'); run(async () => { await markCooked(wid, id, { skipped: true }); if (route === 'recipe') location.hash = '#/cook'; }, 'Taken off the list'); };
actions.notCookingWeek = el => run(() => S.updateH(['weeks', el.dataset.id], Object.fromEntries(cookList().filter(x => x.week === el.dataset.id && !x.done).map(x => [`cooked.${x.mealId}`, { by: S.me(), on: today(), skipped: true }]))), 'Taken off the list');
actions.uncook = el => { const [wid, id] = el.dataset.id.split('|'); run(() => S.updateH(['weeks', wid], { [`cooked.${id}`]: S.deleteField() })); };

routes.recipe = () => {
  const m = mealById(arg);
  if (!m) return empty('book', 'Recipe not found', 'The meal may have been removed.', '<a class="btn" href="#/cook">Back to recipes</a>');
  // The dinner this recipe is for on the cook list (the oldest still to cook, else the latest done).
  const entries = cookList().filter(x => x.mealId === m.id);
  const entry = entries.find(x => !x.done) || entries[entries.length - 1];
  const r = m.recipe || {};
  const from = /^https?:\/\//.test(m.source || '') ? m.source : null;
  let html = `<a class="btn small ghost" href="${entry ? '#/cook' : '#/week'}" style="margin:8px 0 0 -6px">${icon('back')} ${entry ? 'Recipes' : 'Next shop'}</a>`;
  html += head(esc(m.name), { eyebrow: entry ? `${weekName(entry.week, entry)} · ${esc(deliveryNote(entry))}` : 'Recipe' });
  if (m.image && /^https:\/\//.test(m.image)) html += `<img class="recipe-img" src="${esc(m.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
  // Scaled to how many you cook for (Settings › Household, or changed here for this meal).
  const recipeServes = servesNumber(r.servings || m.servings);
  const cookFor = Number(m.cookFor) || householdServes();
  const f = scaleFor(m, householdServes());
  const facts = [(r.time || m.time) && `${icon('clock')} ${esc(r.time || m.time)}`].filter(Boolean);
  html += `<div class="row recipe-facts">${facts.map(f => `<span class="chip outline">${f}</span>`).join('')}
    ${from ? `<a class="chip link" href="${esc(from)}" target="_blank" rel="noopener">${icon('link')} ${esc(hostOf(from))}</a>` : ''}
    ${recipeServes ? `<span class="chip outline serves">${icon('users')} Serves <button class="step" data-act="cookFor" data-id="-1" aria-label="Cook for fewer">${icon('minus')}</button><b>${cookFor}</b><button class="step" data-act="cookFor" data-id="1" aria-label="Cook for more">${icon('plus')}</button></span>` : ''}
    ${'wakeLock' in navigator ? `<button class="chip ${wakeLock ? 'ok' : 'outline'}" data-act="screenOn" aria-pressed="${!!wakeLock}">${icon('sun')} ${wakeLock ? 'Screen stays on' : 'Keep screen on'}</button>` : ''}</div>`;

  const lines = r.lines?.length ? r.lines.map(l => scaleLine(l, f)) : (m.ingredients || []).map(i => `${i.item}${i.qty > 1 ? ` ×${i.qty}` : ''}${i.pantry ? ' (cupboard)' : ''}`);
  html += section('Ingredients', { count: lines.length || null, right: recipeServes && f !== 1 ? `<span class="small muted">Scaled from serves ${recipeServes}</span>` : '' });
  html += lines.length ? `<div class="card"><ul class="ingredients">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>` : `<div class="card soft"><p class="small muted">No ingredients saved. <a href="#/meal/${esc(m.id)}">Add them</a>.</p></div>`;

  html += section('Method');
  if (r.steps?.length) {
    const ticked = keep[`steps:${m.id}`] || [];
    html += `<div class="card"><ol class="method">${r.steps.map((t, i) => `<li><button class="${ticked.includes(i) ? 'done' : ''}" data-act="step" data-id="${i}" aria-pressed="${ticked.includes(i)}"><span class="n">${i + 1}</span><span class="t">${esc(t)}</span></button></li>`).join('')}</ol>
      <p class="tiny muted" style="margin:12px 0 0">${r.by === 'claude' ? `${icon('sparkle')} Method written by Claude for your household${from ? `. The original is on <a href="${esc(from)}" target="_blank" rel="noopener">${esc(hostOf(from))}</a>` : ''}. Check timings as you go.` : `From <a href="${esc(from || '#')}" target="_blank" rel="noopener">${esc(hostOf(from || '') || 'the recipe page')}</a>. Tap a step to tick it off.`}</p></div>`;
  } else if (m.recipeRequested) {
    html += `<div class="card soft"><div class="row nowrap" style="gap:12px"><span class="spinner" style="flex:none"></span><p class="small muted" style="margin:0">${from ? `Reading the method from ${esc(hostOf(from))}…` : 'Claude is writing the method…'} It takes a minute or two.</p></div></div>`;
  } else {
    html += `<div class="card soft"><p class="small muted" style="margin:0 0 10px">${esc(m.recipeMessage || 'No method saved for this one yet.')}</p><button class="btn small tonal" data-act="getRecipe">${icon('sparkle')} ${m.recipeMessage ? 'Try again' : 'Get the method'}</button>${from ? ` <a class="btn small outline" href="${esc(from)}" target="_blank" rel="noopener">${icon('link')} Open ${esc(hostOf(from))}</a>` : ''}</div>`;
    if (!m.recipeMessage) queueMicrotask(() => askRecipe(m));
  }
  html += `<p class="small muted" style="margin:12px 4px 0"><a href="#/meal/${esc(m.id)}">Edit the shop ingredients</a></p>`;

  if (entry?.done && !entry.done.skipped && !entry.done.verdict) {
    html += `<div class="actionbar"><div><span class="sum"><b>Make it again?</b><span>Cooked ${fmtDay(entry.done.on)}</span></span><span class="spacer"></span>${verdictButtons(entry.week, m.id, false, false)}</div></div>`;
  } else if (entry && !entry.done) {
    html += `<div class="actionbar"><div><button class="btn outline" data-act="notCooking" data-id="${esc(entry.week)}|${esc(m.id)}">Not making it</button><span class="spacer"></span>
      <button class="btn primary" data-act="cooked" data-id="${esc(entry.week)}|${esc(m.id)}">${icon('check')} Cooked it</button></div></div>`;
  } else if (entry?.done) {
    html += `<div class="actionbar"><div><span class="sum"><b>${entry.done.skipped ? 'Not making it' : 'Cooked'}</b><span>${fmtDay(entry.done.on)}${entry.done.by?.name ? ` · ${esc(entry.done.by.name.split(' ')[0])}` : ''}</span></span>
      <button class="btn outline" data-act="uncook" data-id="${esc(entry.week)}|${esc(m.id)}">Undo</button></div></div>`;
  }
  return html;
};
actions.cookFor = el => {
  const m = mealById(arg); if (!m) return;
  const n = Math.max(1, Math.min(20, (Number(m.cookFor) || householdServes()) + Number(el.dataset.id)));
  run(() => S.updateH(['meals', m.id], { cookFor: n === householdServes() ? S.deleteField() : n }));
};
actions.getRecipe = () => { const m = mealById(arg); if (m) S.updateH(['meals', m.id], { recipeRequested: true, recipeMessage: S.deleteField() }).catch(e => toast(e.message)); };
actions.step = el => {
  const k = `steps:${arg}`; const i = +el.dataset.id; const t = keep[k] || [];
  keep[k] = t.includes(i) ? t.filter(x => x !== i) : [...t, i];
  render();
};
// Keep the phone's screen on while cooking (Screen Wake Lock API). Released on leaving the recipe.
let wakeLock = null;
async function screenOn(on) {
  if (!on) { const w = wakeLock; wakeLock = null; await w?.release().catch(() => {}); return; }
  try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { if (wakeLock?.released) { wakeLock = null; render(); } }); }
  catch { toast('This phone won\'t keep the screen on from here.'); }
}
actions.screenOn = () => screenOn(!wakeLock).then(render);
hooks.leave.push(() => screenOn(false));
