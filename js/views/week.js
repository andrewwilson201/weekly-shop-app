// Next shop: the delivery day and the dinners for the shop being planned.
import * as S from '../store.js?v=12';
import { addDays, pickIdeas, awayOn, isIdea, planDate } from '../plan.js?v=12';
import { icon, tile, avatar } from '../ui.js?v=12';
import { st, esc, money, fmtDay, today, plural, head, section, empty, run, keep, routes, actions } from '../core.js?v=12';
import { importLink } from './meals.js?v=12';
import { mealById, plan, planId, savePlan, planOrder, activeOrder, nextDelivery, orderLine, slotText, flow, stillToCook, askRecipe } from '../state.js?v=12';

const NEEDS_YOU = ['need_code', 'choose_slot', 'review', 'needs_you'];
// "35 mins" on an idea card: from its recipe, or Claude's estimate.
export const mealTime = m => m?.recipe?.time || m?.time || '';

routes.week = () => {
  const w = plan();
  const wo = planOrder();
  const started = w ? `Started ${fmtDay(planDate(planId()))}` : 'Whenever the food runs out';
  let html = head('Next shop', { eyebrow: started, sub: wo ? '' : 'Choose a delivery day and pick your dinners. The basket is worked out from them.' }) + flow('week');

  // The last order, until it arrives.
  const nd = nextDelivery();
  if (nd && nd.id !== wo?.id) html += `<a class="notice ok" href="#/order/${esc(nd.id)}">${icon('truck')}<span class="grow"><b>${nd.deliveryDate === today() ? 'Arriving today' : `Arriving ${fmtDay(nd.deliveryDate)}`}${nd.slot ? `, ${slotText(nd)}` : ''}</b><br>${nd.total ? `${money(nd.total)} · ` : ''}Forgot something? Add it to the order</span>${icon('chevron', 'chev')}</a>`;
  const left = stillToCook();
  if (left.length) html += `<a class="notice info" href="#/cook">${icon('book')}<span class="grow"><b>${plural(left.length, 'dinner')} still to cook from the last shop</b><br>${esc(left.map(x => mealById(x.mealId)?.name).filter(Boolean).join(' · '))}</span>${icon('chevron', 'chev')}</a>`;
  const away = st.household.away || [];
  const nowAway = awayOn(away, today()) || away.find(a => a.from > today() && a.from <= addDays(today(), 7));
  if (nowAway) html += `<div class="notice warn">${icon('plane')}<span class="grow"><b>Holiday mode</b> · away ${fmtDay(nowAway.from)} to ${fmtDay(nowAway.to)}. Delivery days while you're away can't be picked. <a href="#/settings">Change</a></span></div>`;
  if (!st.meals.length) {
    return html + `<div class="card">${empty('bowl', 'No meals yet', 'Load a starter set of family dinners to get going. You can edit them and add your own.', '<button class="btn primary" data-act="loadStarter">Load starter meals</button>')}</div>`;
  }
  if (!w?.offered?.length) {
    if (w?.ideasRequested) return html + `<div class="card">${empty('sparkle', 'Claude is choosing ideas', 'They\'ll appear here in a minute or two.', '<span class="spinner" style="display:inline-block"></span>')}</div>`;
    return html + `<div class="card">${empty('sparkle', 'Start the next shop', 'Out of food? Get ten dinner ideas and pick as many as you need.',
      `<div class="row" style="justify-content:center"><button class="btn primary" data-act="askClaude">${icon('sparkle')} Ask Claude for ideas</button><button class="btn" data-act="makeIdeas">Pick from our meals now</button></div>`)}</div>` + dishBox();
  }
  const picks = w.picks || {};
  const n = Object.keys(picks).length;
  // Delivery day comes first: it's one tap, and it sets which staples are due and which slots are offered.
  html += section('1. Choose a delivery day');
  // Booked ahead in the Sainsbury's app: the delivery can be up to three weeks out.
  const ahead = w.booked || (w.deliveryDate && w.deliveryDate > addDays(today(), 7)) ? 21 : 7;
  html += `<div class="days">`;
  for (let i = 1; i <= ahead; i++) {
    const d = addDays(today(), i);
    const off = awayOn(away, d);
    html += `<button data-act="day" data-id="${d}" class="${w.deliveryDate === d ? 'on' : ''}" ${off ? 'disabled title="Away"' : ''} aria-pressed="${w.deliveryDate === d}"><small>${fmtDay(d, { weekday: 'short' })}</small><b>${fmtDay(d, { day: 'numeric' })}</b><span>${off ? 'Away' : fmtDay(d, { month: 'short' })}</span></button>`;
  }
  html += `</div>`;
  html += `<label class="card booked row nowrap"><span class="grow"><b>Already booked in the Sainsbury's app?</b>
    <span class="small muted">${w.booked
      ? `This shop goes into the order you booked${w.deliveryDate ? ` for ${fmtDay(w.deliveryDate)}` : ''}, instead of a new slot. Anything you added to get over the minimum can come out when you check the total.`
      : 'Turn this on if you\'ve booked the slot and checked out already. The app adds this shop to that order.'}</span></span>
    <input type="checkbox" class="switch" data-change="booked" ${w.booked ? 'checked' : ''} aria-label="Already booked in the Sainsbury's app"></label>`;
  html += section('2. Pick your dinners', { right: `<span class="small muted">${w.ideasBy === 'claude' ? 'Ideas by Claude' : 'From your meals'}</span>` });
  html += dishBox();
  w.offered.forEach(id => {
    const m = mealById(id); if (!m) return;
    const p = picks[id];
    const tag = w.from?.[id] && !m.timesChosen ? `<span class="chip new">${icon('link')} New on ${esc(w.from[id])}</span>` : m.timesChosen ? `<span class="chip fav">${icon('star')} Picked ${m.timesChosen}×</span>` : m.addedBy?.name === 'Claude' ? `<span class="chip new">${icon('sparkle')} New from Claude</span>` : '<span class="chip">New</span>';
    const time = mealTime(m);
    html += `<button class="meal${p ? ' on' : ''}" data-act="pick" data-id="${esc(id)}" aria-pressed="${p ? 'true' : 'false'}">
      ${tile(m)}
      <span class="grow"><span class="title">${esc(m.name)}</span>
      ${w.reasons?.[id] ? `<span class="why">${esc(w.reasons[id])}</span>` : ''}
      <span class="chips">${tag}${time ? `<span class="chip outline">${icon('clock')} ${esc(time)}</span>` : ''}${ingredientsChip(m)}<span class="chip link" data-act="viewRecipe" data-id="${esc(id)}" role="link">${icon('book')} Recipe</span>${m.cuisine ? `<span class="chip outline">${esc(m.cuisine)}</span>` : ''}${p ? `<span class="chip ok">${avatar(p, 'sm')} ${esc(p.name?.split(' ')[0] || '')}</span>` : ''}</span></span>
      <span class="tick">${icon('check')}</span></button>`;
  });
  html += `<div class="toolbar">
    <button class="btn small tonal" data-act="askClaude" ${w.ideasRequested ? 'disabled' : ''}>${icon('sparkle')} ${w.ideasRequested ? 'Claude is thinking…' : 'Ask Claude for fresh ideas'}</button>
    <button class="btn small outline" data-act="remakeIdeas">${icon('shuffle')} Swap the unpicked ones</button>
    <button class="btn small outline" data-act="addIdea">${icon('bowl')} Browse our meals</button></div>`;
  if (!wo) html += `<p class="small muted" style="margin:4px 4px 0;text-align:right"><button class="link" data-act="startAfresh">Start afresh</button></p>`;

  html += wo
    ? `<div class="actionbar"><div><span class="sum"><b>${wo.state === 'placed' ? 'Ordered' : activeOrder() && NEEDS_YOU.includes(wo.state) ? 'The order needs you' : 'Order in progress'}</b><span>${esc(orderLine(wo))}</span></span><a class="btn primary" href="#/order">View order ${icon('chevron')}</a></div></div>`
    : `<div class="actionbar"><div><span class="sum"><b>${n ? plural(n, 'dinner') : 'No dinners yet'}</b><span>${w.deliveryDate ? `${w.booked ? 'Booked for' : 'Delivery'} ${fmtDay(w.deliveryDate)}` : 'Choose a delivery day'}</span></span>
    <a class="btn primary" href="#/shop">Next: the basket ${icon('chevron')}</a></div></div>`;
  return html;
};
// The "Recipe" chip sits inside the meal's pick button; the click handler finds the chip first, so it doesn't pick.
actions.viewRecipe = el => { location.hash = `#/recipe/${encodeURIComponent(el.dataset.id)}`; };
actions.loadStarter = () => run(async () => {
  const res = await fetch('data/recipes.json'); const { meals } = await res.json();
  await S.batchH(meals.map(m => ['add', ['meals'], { ...m, timesChosen: 0, createdAt: S.serverTimestamp() }]));
}, 'Starter meals loaded');
// The askClaude function (or the worker, as a backup) sees ideasRequested; picks made so far are kept.
actions.askClaude = () => run(() => savePlan({ ideasRequested: true }), 'Asked Claude. Ideas in a minute or two');
actions.makeIdeas = () => run(() => savePlan({ offered: pickIdeas(st.meals, { today: today() }), picks: plan()?.picks || {} }));
actions.remakeIdeas = () => run(async () => {
  const w = plan(); const keepIds = Object.keys(w.picks || {});
  const fresh = pickIdeas(st.meals.filter(m => !w.offered.includes(m.id)), { count: Math.max(3, 10 - keepIds.length), today: today() });
  await savePlan({ offered: [...keepIds, ...fresh] });
});
actions.pick = el => run(() => {
  const id = el.dataset.id; const picks = plan().picks || {};
  // Picked dinners get their method fetched (or written) now, so it's ready to cook from.
  if (!picks[id]) askRecipe(mealById(id));
  // A picked idea joins the meal library.
  if (!picks[id] && isIdea(mealById(id) || {})) S.updateH(['meals', id], { idea: false }).catch(e => console.error(e));
  return S.updateH(['weeks', planId()], { [`picks.${id}`]: picks[id] ? S.deleteField() : S.me() });
});
actions.day = el => run(() => savePlan({ deliveryDate: el.dataset.id }));
actions.booked = el => run(() => savePlan({ booked: el.checked }), el.checked ? 'This shop will go into the order you booked' : 'A new slot will be booked');
actions.addIdea = () => { location.hash = '#/meals'; };
// Put this plan aside (for when the shop was done another way) and start a new one.
actions.startAfresh = () => {
  if (!confirm('Start a new shop from scratch? The dinners picked here are put aside.')) return;
  run(() => S.updateH(['weeks', planId()], { status: 'closed' }), 'New shop started');
};

// "Know what you want to cook?": type a dinner and it's picked for this shop.
// While typing, matching meals you already have are offered first (picking
// one keeps its ingredients and the products you usually buy). Anything new
// is saved as a meal with no ingredients, which the newMeal function (or the
// worker) fills in with Claude, then writes the method. A recipe link pasted
// here is read just like one added on Meals.
const typedMeals = () => st.meals.filter(m => !m.archived && m.name);
function dishBox() {
  const picks = plan()?.picks || {};
  // Your meal library only (as on Meals): unpicked ideas stay out.
  const rows = typedMeals().filter(m => !isIdea(m)).sort((a, b) => (b.timesChosen || 0) - (a.timesChosen || 0) || a.name.localeCompare(b.name)).map(m => `<li data-name="${esc(m.name.toLowerCase())}">${tile(m, 'sm')}
    <span class="grow"><span class="name">${esc(m.name)}</span><span class="meta">${m.timesChosen ? `Picked ${m.timesChosen}× before` : 'In your meals'}</span></span>
    ${picks[m.id] ? `<span class="pill ok">${icon('check')} Picked</span>` : `<button type="button" class="btn small tonal" data-act="pickDish" data-id="${esc(m.id)}">Pick this</button>`}</li>`).join('');
  return `<form class="card dish" data-form="addDish">
    <h3>${icon('plus')} Know what you want to cook?</h3>
    <p class="small muted">Type a dinner, like spaghetti Bolognese, and Claude works out what to buy. A recipe link works too.</p>
    <div class="inputrow"><input type="text" name="dish" data-keep="dish" data-filter="dishMatches" placeholder="e.g. Spaghetti Bolognese" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" aria-label="A dinner, or a recipe link"><button class="btn primary">Add</button></div>
    <div class="dish-matches" id="dishMatches" data-max="4"><p class="small muted">Already in your meals:</p><ul class="list">${rows}</ul></div></form>`;
}
const norm = t => String(t).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9à-ÿ]+/g, ' ').trim();
// Picks a meal for whoever typed it, adding it to this shop's dinners.
async function pickForMe(id) {
  const w = plan() || {};
  const m = mealById(id);
  if (m && isIdea(m)) await S.updateH(['meals', id], { idea: false });
  if (m) askRecipe(m);
  // A dinner you just typed goes to the top, right under the box.
  await savePlan({ offered: [id, ...(w.offered || []).filter(x => x !== id)], picks: { [id]: S.me() } });
}
const clearDish = () => { keep.dish = ''; const i = document.querySelector('[data-keep=dish]'); if (i) i.value = ''; };
actions.pickDish = el => { clearDish(); run(() => pickForMe(el.dataset.id), `${mealById(el.dataset.id)?.name || 'Dinner'} picked`); };
actions.addDish = f => {
  const text = f.dish.value.trim().replace(/\s+/g, ' ');
  if (!text) return;
  clearDish();
  if (/^https?:\/\//i.test(text) || /^www\./i.test(text)) return run(() => importLink(/^www\./i.test(text) ? `https://${text}` : text, true), 'Got it. The recipe will appear in a moment');
  const same = typedMeals().find(m => norm(m.name) === norm(text));
  if (same) return run(() => pickForMe(same.id), `${same.name} picked, from your meals`);
  const name = text.charAt(0).toUpperCase() + text.slice(1);
  run(async () => {
    // recipeAfter: once Claude has the ingredients, the method is written from them.
    const ref = await S.addH(['meals'], { name, ingredients: [], timesChosen: 0, createdAt: S.serverTimestamp(), addedBy: S.me(), typed: true, recipeAfter: true });
    await pickForMe(ref.id);
  }, `${name} added. Claude is working out the ingredients`);
};
// Under a typed dinner: how its ingredients are coming along, with a link to check them.
function ingredientsChip(m) {
  const n = (m.ingredients || []).length;
  if (!n && !m.ingredientsTried) return `<span class="chip working"><span class="spinner"></span> Working out ingredients…</span>`;
  if (!n) return `<span class="chip link warn" data-act="editMeal" data-id="${esc(m.id)}" role="link">${icon('alert')} Add the ingredients</span>`;
  if (m.typed && m.ingredientsBy === 'claude') return `<span class="chip link" data-act="editMeal" data-id="${esc(m.id)}" role="link">${icon('sparkle')} ${plural(n, 'ingredient')} · check</span>`;
  return '';
}
actions.editMeal = el => { location.hash = `#/meal/${encodeURIComponent(el.dataset.id)}`; };
