import * as S from './store.js';
import { weekId, iso, addDays, buildShop, stapleStatus, pickIdeas, awayOn, awayWeek, skipRule, matchUsual, toCook, isIdea, lastVerdict, servesNumber, scaleFor, scaleLine } from './plan.js?v=8';
import { icon, tile, avatar, MEAL_CATEGORIES, mealCategory, autoCategory, categoryTile } from './ui.js?v=8';

const $main = document.getElementById('main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n == null || isNaN(n) ? '' : `£${Number(n).toFixed(2)}`);
const fmtDay = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'Europe/London' });
const fmtTime = t => new Date(t).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London' }).replace(':00', '').replace(' ', '');
const today = () => iso(new Date());
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const head = (title, { eyebrow = '', sub = '', right = '' } = {}) => `<header class="page-head">${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}
  <div class="row nowrap"><h1>${title}</h1><span class="spacer"></span>${right}</div>${sub ? `<p>${sub}</p>` : ''}</header>`;
const section = (title, { count = null, right = '' } = {}) => `<div class="section-head"><h2>${title}${count != null ? ` <span class="count">${count}</span>` : ''}</h2><span class="spacer"></span>${right}</div>`;
const empty = (ic, title, text, action = '') => `<div class="empty"><div class="art">${icon(ic)}</div><h3>${title}</h3><p>${text}</p>${action}</div>`;

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
}
async function run(fn, done) {
  try { await fn(); if (done) toast(done); } catch (e) { console.error(e); toast(e.message || 'Something went wrong'); }
}

// ---------- routing ----------
const routes = { week: viewWeek, cook: viewCook, recipe: viewRecipe, list: viewList, shop: viewShop, order: viewOrder, meals: viewMeals, meal: viewMeal, staples: viewStaples, settings: viewSettings };
let route = 'week', arg = null;
function parseHash() {
  const [, r = 'week', a = null] = (location.hash || '#/week').split('/');
  route = routes[r] ? r : 'week'; arg = a && decodeURIComponent(a);
}
window.addEventListener('hashchange', () => { parseHash(); keep = {}; screenOn(false); render(); window.scrollTo(0, 0); });
parseHash();
window.addEventListener('scroll', () => document.getElementById('topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });

// Inputs being typed into survive live re-renders.
let keep = {};
function remember() {
  document.querySelectorAll('[data-keep]').forEach(el => { keep[el.dataset.keep] = el.value; });
  const a = document.activeElement;
  return a && a.dataset && a.dataset.keep ? { k: a.dataset.keep, s: a.selectionStart } : null;
}
function restore(focus) {
  document.querySelectorAll('[data-keep]').forEach(el => { if (keep[el.dataset.keep] != null) el.value = keep[el.dataset.keep]; });
  document.querySelectorAll('[data-filter]').forEach(applyFilter);
  if (focus) {
    const el = document.querySelector(`[data-keep="${focus.k}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(focus.s, focus.s); } catch {} }
  }
}

let st = S.getState();
S.onChange(s => { st = s; render(); });

function render() {
  const tabs = document.getElementById('tabs');
  const settings = document.getElementById('settingsLink');
  const ready = st.ready && st.user && st.household?.members;
  tabs.hidden = !ready; settings.hidden = !ready;
  document.getElementById('sync').textContent = navigator.onLine ? '' : 'Offline';
  document.getElementById('who').innerHTML = ready ? Object.entries(st.household.memberNames || {}).map(([uid, name]) => avatar({ uid, name })).join('') : '';
  const tab = { shop: 'week', order: 'week', recipe: 'cook', meal: 'meals', staples: 'meals' }[route] || route;
  tabs.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  const focus = remember();
  if (!st.ready) { $main.innerHTML = '<div class="loading"><span class="spinner"></span></div>'; return; }
  if (!st.user) { $main.innerHTML = viewSignIn(); bind(); return; }
  if (!st.household?.members) { $main.innerHTML = viewSetup(); bind(); return; }
  $main.innerHTML = routes[route]();
  bind();
  takeSharedLink();
  restore(focus);
}

// Event delegation: elements carry data-act="name" and optional data-id.
const actions = {};
function bind() {
  $main.querySelectorAll('form[data-form]').forEach(f => f.onsubmit = e => { e.preventDefault(); actions[f.dataset.form]?.(f, e); });
}
$main.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'FORM') return;
  e.preventDefault();
  actions[el.dataset.act]?.(el, e);
});
$main.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el) actions[el.dataset.change]?.(el, e);
});
// <details data-toggle="key"> remember whether they're open across live re-renders.
$main.addEventListener('toggle', e => { const el = e.target; if (el.dataset?.toggle) keep[el.dataset.toggle] = el.open; }, true);
// Open meal categories are remembered until the app is closed, but not the ones a search opened.
const openCats = new Set();
$main.addEventListener('toggle', e => {
  const el = e.target;
  if (!el.dataset?.cat || el.closest('[data-searching]')) return;
  if (el.open) openCats.add(el.dataset.cat); else openCats.delete(el.dataset.cat);
}, true);
$main.addEventListener('input', e => { const el = e.target; if (el.dataset?.keep) keep[el.dataset.keep] = el.value; if (el.dataset?.filter) applyFilter(el); });
// Search boxes filter the rows of the list they name, without a re-render.
function applyFilter(el) {
  const q = el.value.trim().toLowerCase();
  const root = document.getElementById(el.dataset.filter);
  if (!root) return;
  root.querySelectorAll('li[data-name]').forEach(li => { li.hidden = !!q && !li.dataset.name.includes(q); });
  // In a grouped list, hide a group whose rows are all filtered out.
  root.querySelectorAll('[data-group]').forEach(g => { g.hidden = !!q && !g.querySelector('li[data-name]:not([hidden])'); });
  // Collapsed groups open while searching, and go back to how they were after.
  if (q) root.dataset.searching = '';
  root.querySelectorAll('details[data-group]').forEach(g => {
    if (q) { if (g.dataset.wasOpen == null) g.dataset.wasOpen = g.open ? '1' : ''; g.open = !g.hidden; }
    else if (g.dataset.wasOpen != null) { g.open = g.dataset.wasOpen === '1'; delete g.dataset.wasOpen; }
  });
  if (!q) delete root.dataset.searching;
}

// ---------- sign in & household ----------
const GOOGLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>';
function viewSignIn() {
  const f = (ic, kind, title, text) => `<li>${`<span class="tile ${kind}">${icon(ic)}</span>`}<span class="grow"><b>${title}</b><span>${text}</span></span></li>`;
  return `<div class="signin"><img class="logo" src="icon.svg" alt="">
    <h1>Weekly Shop</h1><p class="lede">Plan the week's dinners together and send one shop to Sainsbury's.</p>
    <ul class="list card features">
      ${f('sparkle', 'other', 'Meal ideas that learn', 'Ten ideas whenever you shop, shaped by what you pick.')}
      ${f('list', 'veg', 'One shared list', 'Add things from either phone. It updates live.')}
      ${f('lock', 'fish', 'You approve every order', 'See the total before anything is paid for.')}
    </ul>
    <button class="btn primary lg block gbtn" data-act="signIn" style="background:var(--surface);color:var(--text);box-shadow:var(--shadow-1)">${GOOGLE} Continue with Google</button>
    ${S.emulator ? `<form data-form="testSignIn" class="card" style="margin-top:20px;text-align:left"><p class="tiny muted">Emulator test sign-in</p>
      <input type="text" name="name" placeholder="Name"><input type="text" name="email" placeholder="Email" style="margin-top:8px"><button class="btn block" style="margin-top:8px">Test sign in</button></form>` : ''}</div>`;
}
actions.signIn = () => run(S.signIn);
actions.testSignIn = f => run(async () => { await S.testSignIn(f.name.value, f.email.value); location.reload(); });

const inviteFromUrl = () => new URLSearchParams(location.search).get('join');
function viewSetup() {
  const code = inviteFromUrl();
  if (code) {
    return `${head('Join a household', { eyebrow: 'Invite', sub: 'You\'ve been invited to share a weekly shop.' })}
      <div class="card"><div class="row nowrap" style="gap:14px"><span class="tile veg">${icon('users')}</span><h3 id="inviteName" class="grow">Checking the invite…</h3></div>
      <button class="btn primary lg block" style="margin-top:16px" data-act="join">Join</button></div>
      <p class="small muted" style="margin:0 4px">Signed in as ${esc(st.user.email)}. <button class="link" data-act="signOut">Not you?</button></p>${checkInvite(code)}`;
  }
  return `${head('Set up your household', { eyebrow: 'Welcome', sub: 'Make a household, then send the invite link to whoever you shop with.' })}
    <form class="card" data-form="create">
      <label class="field">Household name<input type="text" name="name" value="${esc((st.user.displayName || '').split(' ').pop() || 'Our')} household" required></label>
      <button class="btn primary lg block">Create household</button>
    </form>
    <p class="small muted" style="margin:0 4px">Got an invite link? Open it on this phone to join instead.<br>Signed in as ${esc(st.user.email)}. <button class="link" data-act="signOut">Sign out</button></p>`;
}
function checkInvite(code) {
  S.lookupInvite(code).then(inv => {
    const el = document.getElementById('inviteName');
    if (el) el.textContent = inv ? `Join “${inv.name}”?` : 'This invite link has expired. Ask for a new one.';
  }).catch(() => {});
  return '';
}
actions.create = f => run(() => S.createHousehold(f.name.value.trim() || 'Our household'));
actions.join = () => run(async () => { await S.joinHousehold(inviteFromUrl()); history.replaceState(null, '', location.pathname + '#/week'); }, 'Joined');
actions.signOut = () => run(S.signOut);

// ---------- helpers on state ----------
const mealById = id => st.meals.find(m => m.id === id);
const thisWeekId = () => weekId(new Date());
const week = () => st.weeks[thisWeekId()];
const DONE_STATES = ['placed', 'failed', 'cancelled', 'trial_done'];
const activeOrder = () => st.orders.find(o => !DONE_STATES.includes(o.state));
// How many the household cooks for (Settings › Household), for scaling recipes.
const householdServes = () => Number(st.household?.serves) || 4;
const deliveryDate = () => week()?.deliveryDate || null;
const pickedMeals = () => Object.keys(week()?.picks || {}).map(mealById).filter(Boolean);
const TARGET = 5;
// This week's order, running or placed.
const weekOrder = () => { const a = activeOrder(); return a && !a.trial ? a : st.orders.find(o => o.state === 'placed' && o.week === thisWeekId() && !o.trial); };
const orderLine = o => o.state === 'placed'
  ? `${fmtDay(o.deliveryDate)}${o.slot ? `, ${fmtTime(o.slot.start_time)}–${fmtTime(o.slot.end_time)}` : ''}${o.total ? ` · ${money(o.total)}` : ''}`
  : stateLabel(o.state);

// The weekly job is three steps: dinners, shop, order. Each screen in it shows
// the steps so it's clear where you are and what comes next.
function flow(now) {
  const w = week() || {};
  const o = weekOrder();
  const done = { week: Object.keys(w.picks || {}).length > 0 && !!w.deliveryDate, shop: !!o, order: o?.state === 'placed' };
  return `<nav class="flow" aria-label="This week's steps">` + [['week', 'Dinners'], ['shop', 'Shop'], ['order', 'Order']].map(([r, label], i) =>
    `<a href="#/${r}" class="${r === now ? 'now' : ''}${done[r] ? ' done' : ''}"${r === now ? ' aria-current="step"' : ''}><span class="n">${done[r] && r !== now ? icon('check') : i + 1}</span>${label}</a>`).join('<span class="sep"></span>') + `</nav>`;
}

// ---------- This week ----------
function viewWeek() {
  const w = week();
  const order = activeOrder();
  const wo = weekOrder();
  let html = head('This week', { eyebrow: `Week of ${fmtDay(thisWeekId(), { day: 'numeric', month: 'long' })}`, sub: wo ? '' : `Choose a delivery day and pick ${TARGET} dinners. The shop is worked out from them.` }) + flow('week');
  // A running or placed order is shown once, in the bar at the bottom.

  const away = st.household.away || [];
  const nowAway = awayOn(away, today()) || (awayWeek(away, thisWeekId()) && away.find(a => a.to >= today()));
  const left = stillToCook();
  if (left.length) html += `<a class="notice info" href="#/cook">${icon('book')}<span class="grow"><b>${plural(left.length, 'dinner')} still to cook from ${left.every(x => x.week === addDays(thisWeekId(), -7)) ? 'last week' : 'earlier weeks'}</b><br>${esc(left.map(x => mealById(x.mealId)?.name).filter(Boolean).join(' · '))}</span>${icon('chevron', 'chev')}</a>`;
  if (nowAway) html += `<div class="notice warn">${icon('plane')}<span class="grow"><b>Holiday mode</b> · away ${fmtDay(nowAway.from)} to ${fmtDay(nowAway.to)}. Delivery days while you're away can't be picked. <a href="#/settings">Change</a></span></div>`;
  if (!st.meals.length) {
    return html + `<div class="card">${empty('bowl', 'No meals yet', 'Load a starter set of family dinners to get going. You can edit them and add your own.', '<button class="btn primary" data-act="loadStarter">Load starter meals</button>')}</div>`;
  }
  if (!w?.offered?.length) {
    if (w?.ideasRequested) return html + `<div class="card">${empty('sparkle', 'Claude is choosing this week\'s ideas', 'They\'ll appear here in a minute or two.', '<span class="spinner" style="display:inline-block"></span>')}</div>`;
    return html + `<div class="card">${empty('sparkle', 'No ideas yet this week', 'Out of food? Get ten dinner ideas and start this shop now.',
      `<div class="row" style="justify-content:center"><button class="btn primary" data-act="askClaude">${icon('sparkle')} Ask Claude for ideas</button><button class="btn" data-act="makeIdeas">Pick from our meals now</button></div>`)}</div>`;
  }
  const picks = w.picks || {};
  const n = Object.keys(picks).length;
  // How many are picked is shown once, in the bar at the bottom.
  // Delivery day comes first: it's one tap, and it sets which staples are due and which slots are offered.
  html += section('1. Choose a delivery day');
  html += `<div class="days">`;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today(), i);
    const off = awayOn(away, d);
    html += `<button data-act="day" data-id="${d}" class="${w.deliveryDate === d ? 'on' : ''}" ${off ? 'disabled title="Away"' : ''} aria-pressed="${w.deliveryDate === d}"><small>${fmtDay(d, { weekday: 'short' })}</small><b>${fmtDay(d, { day: 'numeric' })}</b><span>${off ? 'Away' : fmtDay(d, { month: 'short' })}</span></button>`;
  }
  html += `</div>`;
  html += section('2. Pick your dinners', { right: `<span class="small muted">${w.ideasBy === 'claude' ? 'Ideas by Claude' : 'From your meals'}</span>` });
  w.offered.forEach(id => {
    const m = mealById(id); if (!m) return;
    const p = picks[id];
    const tag = w.from?.[id] && !m.timesChosen ? `<span class="chip new">${icon('link')} New on ${esc(w.from[id])}</span>` : m.timesChosen ? `<span class="chip fav">${icon('star')} Picked ${m.timesChosen}×</span>` : m.addedBy?.name === 'Claude' ? `<span class="chip new">${icon('sparkle')} New from Claude</span>` : '<span class="chip">New</span>';
    html += `<button class="meal${p ? ' on' : ''}" data-act="pick" data-id="${esc(id)}" aria-pressed="${p ? 'true' : 'false'}">
      ${tile(m)}
      <span class="grow"><span class="title">${esc(m.name)}</span>
      ${w.reasons?.[id] ? `<span class="why">${esc(w.reasons[id])}</span>` : ''}
      <span class="chips">${tag}<span class="chip link" data-act="viewRecipe" data-id="${esc(id)}" role="link">${icon('book')} Recipe</span>${m.cuisine ? `<span class="chip outline">${esc(m.cuisine)}</span>` : ''}${p ? `<span class="chip ok">${avatar(p, 'sm')} ${esc(p.name?.split(' ')[0] || '')}</span>` : ''}</span></span>
      <span class="tick">${icon('check')}</span></button>`;
  });
  html += `<div class="toolbar">
    <button class="btn small tonal" data-act="askClaude" ${w.ideasRequested ? 'disabled' : ''}>${icon('sparkle')} ${w.ideasRequested ? 'Claude is thinking…' : 'Ask Claude for fresh ideas'}</button>
    <button class="btn small outline" data-act="remakeIdeas">${icon('shuffle')} Swap the unpicked ones</button>
    <button class="btn small outline" data-act="addIdea">${icon('plus')} Add another meal</button></div>`;

  html += wo
    ? `<div class="actionbar"><div><span class="sum"><b>${wo.state === 'placed' ? 'Ordered' : activeOrder() && ['need_code', 'choose_slot', 'review', 'needs_you'].includes(wo.state) ? 'The order needs you' : 'Order in progress'}</b><span>${esc(orderLine(wo))}</span></span><a class="btn primary" href="#/order">View order ${icon('chevron')}</a></div></div>`
    : `<div class="actionbar"><div><span class="sum"><b>${n} of ${TARGET} dinners</b><span>${w.deliveryDate ? `Delivery ${fmtDay(w.deliveryDate)}` : 'Choose a delivery day'}</span></span>
    <a class="btn primary" href="#/shop">Next: the shop ${icon('chevron')}</a></div></div>`;
  return html;
}
// The "Recipe" chip sits inside the meal's pick button; the click handler finds the chip first, so it doesn't pick.
actions.viewRecipe = el => { location.hash = `#/recipe/${encodeURIComponent(el.dataset.id)}`; };
actions.loadStarter = () => run(async () => {
  const res = await fetch('data/recipes.json'); const { meals } = await res.json();
  await S.batchH(meals.map(m => ['add', ['meals'], { ...m, timesChosen: 0, createdAt: S.serverTimestamp() }]));
}, 'Starter meals loaded');
// The askClaude function (or the worker, as a backup) sees ideasRequested; picks made so far are kept.
actions.askClaude = () => run(() => week() ? S.updateH(['weeks', thisWeekId()], { ideasRequested: true }) : S.setH(['weeks', thisWeekId()], { ideasRequested: true, offered: [], picks: {}, createdAt: S.serverTimestamp() }), 'Asked Claude. Ideas in a minute or two');
actions.makeIdeas = () => run(() => S.setH(['weeks', thisWeekId()], { offered: pickIdeas(st.meals, { today: today() }), picks: {}, createdAt: S.serverTimestamp() }));
actions.remakeIdeas = () => run(async () => {
  const w = week(); const keepIds = Object.keys(w.picks || {});
  const fresh = pickIdeas(st.meals.filter(m => !w.offered.includes(m.id)), { count: 10 - keepIds.length, today: today() });
  await S.setH(['weeks', thisWeekId()], { offered: [...keepIds, ...fresh] });
});
actions.pick = el => run(() => {
  const id = el.dataset.id; const picks = week().picks || {};
  // Picked dinners get their method fetched (or written) now, so it's ready to cook from.
  if (!picks[id]) askRecipe(mealById(id));
  // A picked idea joins the meal library.
  if (!picks[id] && isIdea(mealById(id) || {})) S.updateH(['meals', id], { idea: false }).catch(e => console.error(e));
  return S.updateH(['weeks', thisWeekId()], { [`picks.${id}`]: picks[id] ? S.deleteField() : S.me() });
});
actions.day = el => run(() => S.setH(['weeks', thisWeekId()], { deliveryDate: el.dataset.id }));
actions.addIdea = () => { location.hash = '#/meals'; };

// ---------- Recipes (what to cook) ----------
// Dinners shopped for stay here until they're marked cooked, so last week's
// are still easy to find after the next week's shop is ordered (toCook in plan.js).
const cookList = () => toCook({ weeks: st.weeks, orders: st.orders, current: thisWeekId() }).filter(x => mealById(x.mealId));
const stillToCook = () => cookList().filter(x => !x.done && x.week < thisWeekId());
const hasMethod = m => !!m?.recipe?.steps?.length;
// Ask the functions (or the worker) for a meal's method: from its page, or written by Claude.
function askRecipe(m) {
  if (!m || hasMethod(m) || m.recipeRequested) return;
  S.updateH(['meals', m.id], { recipeRequested: true, recipeMessage: S.deleteField() }).catch(e => console.error(e));
}
const weekName = wid => wid === thisWeekId() ? 'This week' : wid === addDays(thisWeekId(), -7) ? 'Last week' : `Week of ${fmtDay(wid, { day: 'numeric', month: 'short' })}`;
function deliveryNote(x) {
  if (!x.ordered) return x.week === thisWeekId() ? 'Not ordered yet' : 'Ordered';
  if (!x.delivery) return 'Ordered';
  return x.delivery <= today() ? `Delivered ${fmtDay(x.delivery)}` : `Arriving ${fmtDay(x.delivery)}`;
}
function recipeMeta(m) {
  const bits = [];
  if (m.recipe?.time) bits.push(m.recipe.time);
  if (hasMethod(m)) bits.push(m.recipe.by === 'claude' ? 'Method by Claude' : `From ${hostOf(m.source || '') || 'the recipe page'}`);
  else if (m.recipeRequested) bits.push('Getting the method…');
  else if (m.source) bits.push(`Recipe on ${hostOf(m.source)}`);
  return bits.join(' · ');
}
function viewCook() {
  const all = cookList();
  const todo = all.filter(x => !x.done);
  let html = head('Recipes', { eyebrow: 'To cook', sub: 'The dinners you\'ve shopped for, with their recipes. Each stays here until you mark it cooked, even after the next shop.' });
  if (!todo.length) {
    html += `<div class="card">${empty('book', all.length ? 'All cooked' : 'Nothing to cook yet', all.length ? 'Everything you shopped for is done. Next week\'s dinners appear here once you pick them.' : 'Pick this week\'s dinners and they\'ll show here with their recipes.', '<a class="btn primary" href="#/week">This week</a>')}</div>`;
  }
  const weeks = [...new Set(todo.map(x => x.week))];
  for (const wid of weeks) {
    const rows = todo.filter(x => x.week === wid);
    const past = wid < thisWeekId();
    html += section(weekName(wid), { count: rows.length, right: `<span class="small muted">${esc(deliveryNote(rows[0]))}</span>` });
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
}
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

function viewRecipe() {
  const m = mealById(arg);
  if (!m) return empty('book', 'Recipe not found', 'The meal may have been removed.', '<a class="btn" href="#/cook">Back to recipes</a>');
  // The dinner this recipe is for on the cook list (the oldest still to cook, else the latest done).
  const entries = cookList().filter(x => x.mealId === m.id);
  const entry = entries.find(x => !x.done) || entries[entries.length - 1];
  const r = m.recipe || {};
  const from = /^https?:\/\//.test(m.source || '') ? m.source : null;
  let html = `<a class="btn small ghost" href="${entry ? '#/cook' : '#/week'}" style="margin:8px 0 0 -6px">${icon('back')} ${entry ? 'Recipes' : 'This week'}</a>`;
  html += head(esc(m.name), { eyebrow: entry ? `${weekName(entry.week)} · ${esc(deliveryNote(entry))}` : 'Recipe' });
  if (m.image && /^https:\/\//.test(m.image)) html += `<img class="recipe-img" src="${esc(m.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
  // Scaled to how many you cook for (Settings › Household, or changed here for this meal).
  const recipeServes = servesNumber(r.servings || m.servings);
  const cookFor = Number(m.cookFor) || householdServes();
  const f = scaleFor(m, householdServes());
  const facts = [r.time && `${icon('clock')} ${esc(r.time)}`].filter(Boolean);
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
}
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

// ---------- List ----------
function viewList() {
  const items = st.list;
  const open = items.filter(i => !i.done).length;
  let html = head('Shopping list', { eyebrow: 'Shared', sub: 'Add things as you run out during the week. They go in the next shop with the dinners and staples.' });
  html += `<form data-form="addItem" class="inputrow"><input type="text" name="text" data-keep="newItem" placeholder="Add an item, e.g. olive oil x2" autocomplete="off" enterkeyhint="done" aria-label="New item"><button class="btn primary" aria-label="Add">${icon('plus')} Add</button></form>`;
  if (!items.length) return html + empty('list', 'The list is empty', 'Add anything you need. Both of you see changes straight away.');
  html += section('On the list', { count: open, right: items.some(i => i.done) ? '<button class="btn small ghost" data-act="clearDone">Clear ticked</button>' : '' });
  html += `<div class="card flush"><ul class="list inset-check">`;
  for (const it of items) {
    html += `<li><input type="checkbox" class="check round" data-change="toggleItem" data-id="${it.id}" ${it.done ? 'checked' : ''} aria-label="Got it">
      <span class="grow"><span class="name ${it.done ? 'strike' : ''}">${esc(it.text)}${it.qty > 1 ? `<span class="qty">×${it.qty}</span>` : ''}</span>
      <span class="meta">${it.done ? '' : productLine(it)}Added by ${esc(it.addedBy?.name?.split(' ')[0] || 'someone')}${it.orderedIn ? ' · in an order' : ''}</span></span>
      <button class="iconbtn sm" data-act="delItem" data-id="${it.id}" aria-label="Remove">${icon('x')}</button></li>`;
    if (keep.choose === it.id && !it.done) html += chooser(it);
  }
  return html + `</ul></div>`;
}

// "Your usual": which product a typed item becomes. A product picked by hand
// wins; "anyProduct" means let Sainsbury's search pick; otherwise the best
// match from past orders.
function usual(it) {
  if (it.uid) return { uid: it.uid, name: it.product || it.text, picked: true };
  if (it.anyProduct) return null;
  const m = matchUsual(it.text, st.products, 1)[0];
  return m ? { uid: m.u, name: m.n } : null;
}
function productLine(it) {
  const u = usual(it);
  const change = `<button class="link" data-act="chooseProduct" data-id="${it.id}">Change</button>`;
  if (u) return `<span class="usual">${u.picked ? 'Ordering' : 'Your usual'}: ${esc(u.name)} · ${change}</span>`;
  const any = matchUsual(it.text, st.products, 1).length;
  return `<span class="usual">Sainsbury's top match${any ? ` · ${change}` : ''}</span>`;
}
function chooser(it) {
  const opts = matchUsual(it.text, st.products, 8);
  const cur = usual(it)?.uid;
  return `<li class="chooser"><span class="grow"><span class="meta">Pick the product to order</span><ul class="list compact">` +
    opts.map(p => `<li><button class="pick ${String(p.u) === String(cur) ? 'on' : ''}" data-act="pickProduct" data-id="${it.id}" data-uid="${esc(p.u)}"><span class="grow"><span class="name">${esc(p.n)}</span><span class="meta">Bought ${p.c === 1 ? 'once' : `${p.c} times`}, last ${esc(fmtDay(p.l, { day: 'numeric', month: 'short', year: 'numeric' }))}</span></span>${String(p.u) === String(cur) ? icon('check') : ''}</button></li>`).join('') +
    `<li><button class="pick ${cur ? '' : 'on'}" data-act="pickProduct" data-id="${it.id}" data-uid=""><span class="grow"><span class="name">Something new</span><span class="meta">Let Sainsbury's search pick its top match</span></span>${cur ? '' : icon('check')}</button></li></ul></span></li>`;
}
actions.chooseProduct = el => { keep.choose = keep.choose === el.dataset.id ? null : el.dataset.id; render(); };
actions.pickProduct = el => {
  const uid = el.dataset.uid;
  const p = st.products.find(x => String(x.u) === uid);
  keep.choose = null;
  run(() => S.updateH(['list', el.dataset.id], uid ? { uid, product: p?.n || '', anyProduct: S.deleteField() } : { uid: S.deleteField(), product: S.deleteField(), anyProduct: true }));
};
actions.addItem = f => {
  const text = f.text.value.trim(); if (!text) return;
  const m = text.match(/^(.*?)\s*(?:x|×)\s*(\d+)$/i);
  keep.newItem = ''; f.text.value = '';
  run(() => S.addH(['list'], { text: m ? m[1] : text, qty: m ? +m[2] : 1, addedBy: S.me(), addedAt: S.serverTimestamp(), done: false }));
};
actions.toggleItem = el => run(() => S.updateH(['list', el.dataset.id], { done: el.checked }));
actions.delItem = el => run(() => S.deleteH(['list', el.dataset.id]));
actions.clearDone = () => run(() => S.batchH(st.list.filter(i => i.done).map(i => ['delete', ['list', i.id]])));

// ---------- Shop ----------
function shopLines() {
  const w = week() || {};
  const list = st.list.map(it => { const u = usual(it); return u ? { ...it, uid: u.uid, product: u.name } : it; });
  return buildShop({ staples: st.staples, meals: pickedMeals(), list, delivery: w.deliveryDate || addDays(today(), 2), extras: w.extras || {}, qtys: w.qtys || {}, serves: householdServes() });
}
// Each line has − / + for how many; − at 1 leaves it out (like unticking).
const lineRow = l => `<li><input type="checkbox" class="check" checked data-change="lineOff" data-id="${esc(l.key)}" aria-label="Include">
  <span class="grow"><span class="name">${esc(l.name)}</span>${l.product ? `<span class="meta">${esc(l.product)}</span>` : ''}${l.for ? `<span class="meta">${esc(l.for.join(' · '))}</span>` : ''}</span>
  <span class="stepper"><button class="step" data-act="qty" data-id="${esc(l.key)}" data-q="${l.qty - 1}" aria-label="${l.qty > 1 ? 'One fewer' : 'Leave out'} ${esc(l.name)}">${icon(l.qty > 1 ? 'minus' : 'x')}</button><b aria-label="Quantity">${l.qty}</b><button class="step" data-act="qty" data-id="${esc(l.key)}" data-q="${l.qty + 1}" aria-label="One more ${esc(l.name)}">${icon('plus')}</button></span></li>`;
function viewShop() {
  const w = week();
  const order = activeOrder();
  if (order) return head('The shop') + flow('shop') + `<a class="notice info" href="#/order">${icon('truck')}<span class="grow"><b>An order is in progress</b><br>${esc(stateLabel(order.state))}. The shop can't change until it's finished.</span>${icon('chevron', 'chev')}</a>`;
  const lines = shopLines();
  const extras = w?.extras || {};
  let html = head('The shop', { eyebrow: w?.deliveryDate ? `Delivery ${fmtDay(w.deliveryDate, { weekday: 'long', day: 'numeric', month: 'long' })}` : 'Next shop', sub: 'Everything that will go in the basket. Untick anything you don\'t need, then send it to Sainsbury\'s.' }) + flow('shop');
  if (!w?.deliveryDate) html += `<a class="notice warn" href="#/week">${icon('calendar')}<span class="grow"><b>Choose a delivery day first</b><br>It decides which staples are due.</span>${icon('chevron', 'chev')}</a>`;
  const by = src => lines.filter(l => l.source === src);

  const staples = by('staple');
  const skipped = Object.entries(extras).filter(([k, v]) => k.startsWith('staple:') && v === false).length;
  html += section('Staples due', { count: staples.length, right: `${staples.length ? '<button class="btn small ghost" data-act="skipStaples">Skip all staples</button>' : ''}${skipped ? `<button class="btn small ghost" data-act="unskipStaples">Put back ${skipped}</button>` : ''}` });
  if (!staples.length) html += `<div class="card soft"><p class="small muted">${st.staples.length ? 'None this week.' : 'No staples yet. Import them in Settings.'}</p></div>`;
  else html += `<details class="card flush disclosure" ${keep.staplesOpen ? 'open' : ''} data-toggle="staplesOpen"><summary>${icon('layers')} ${plural(staples.length, 'staple')} due, from your past orders</summary><ul class="list inset-check">${staples.map(lineRow).join('')}</ul></details>`;

  const meals = by('meal');
  html += section('For the meals', { count: meals.length });
  html += meals.length ? `<div class="card flush"><ul class="list inset-check">${meals.map(lineRow).join('')}</ul></div>` : `<div class="card soft"><p class="small muted">No meals picked yet. <a href="#/week">Pick dinners</a>.</p></div>`;
  const list = by('list');
  html += section('From the list', { count: list.length });
  // Anything else goes on the shared list from here too.
  html += `<form data-form="addItem" class="inputrow" style="margin-bottom:10px"><input type="text" name="text" data-keep="newItem" placeholder="Add something else, e.g. milk x2" autocomplete="off" enterkeyhint="done" aria-label="Add an item"><button class="btn tonal" aria-label="Add">${icon('plus')} Add</button></form>`;
  html += list.length ? `<div class="card flush"><ul class="list inset-check">${list.map(lineRow).join('')}</ul></div>` : '';

  // Staples not added: suggestions and ones switched off
  const off = st.staples.filter(s => !lines.some(l => l.key === `staple:${s.id}`)).map(s => ({ s, status: stapleStatus(s, w?.deliveryDate || addDays(today(), 2)) }))
    .filter(x => x.status === 'suggest' || extras[`staple:${x.s.id}`] === false);
  const offMeal = pickedMeals().flatMap(m => (m.ingredients || []).filter(i => !lines.some(l => l.key === `meal:${m.id}:${i.item}`)).map(i => ({ key: `meal:${m.id}:${i.item}`, name: i.item, for: i.pantry && extras[`meal:${m.id}:${i.item}`] !== false ? `${m.name} · probably in the cupboard` : m.name })));
  if (off.length || offMeal.length) {
    html += `<details class="card flush disclosure" style="margin-top:12px"><summary>${icon('plus')} Suggestions and things you unticked <span class="count">${off.length + offMeal.length}</span></summary><ul class="list inset-check">` +
      off.map(({ s, status }) => `<li><input type="checkbox" class="check" data-change="lineOn" data-id="staple:${esc(s.id)}" aria-label="Add"><span class="grow"><span class="name">${esc(s.name)}</span><span class="meta">${status === 'suggest' ? 'Sometimes needed for meals' : 'Unticked'}</span></span></li>`).join('') +
      offMeal.map(x => `<li><input type="checkbox" class="check" data-change="lineOn" data-id="${esc(x.key)}" aria-label="Add"><span class="grow"><span class="name">${esc(x.name)}</span><span class="meta">${esc(x.for)}</span></span></li>`).join('') +
      `</ul></details>`;
  }
  html += `<div class="actionbar"><div><span class="sum"><b>${plural(lines.length, 'item')}</b><span>You approve the total before paying</span></span>
    <button class="btn primary" data-act="order" ${w?.deliveryDate && lines.length ? '' : 'disabled'}>${icon('cart')} Send to Sainsbury's</button></div></div>`;
  return html;
}
const setExtra = (key, val) => S.setH(['weeks', thisWeekId()], { extras: { [key]: val } });
actions.skipStaples = () => run(() => S.setH(['weeks', thisWeekId()], { extras: Object.fromEntries(shopLines().filter(l => l.source === 'staple').map(l => [l.key, false])) }), 'Staples skipped this week');
actions.unskipStaples = () => run(() => S.setH(['weeks', thisWeekId()], { extras: Object.fromEntries(Object.entries(week()?.extras || {}).filter(([k, v]) => k.startsWith('staple:') && v === false).map(([k]) => [k, S.deleteField()])) }));
actions.lineOff = el => run(() => setExtra(el.dataset.id, false));
actions.qty = el => {
  const key = el.dataset.id, q = Number(el.dataset.q);
  if (q < 1) { run(() => setExtra(key, false)); return; }
  run(() => S.setH(['weeks', thisWeekId()], { qtys: { [key]: q } }));
};
actions.lineOn = el => run(() => setExtra(el.dataset.id, true));
actions.order = () => startOrder(false);
// trial: Settings › Order helper › Trial run. Same shop, but it stops before Place order.
const startOrder = trial => run(async () => {
  if (activeOrder()) { location.hash = '#/order'; return; }
  const w = trial ? { ...(week() || {}), deliveryDate: week()?.deliveryDate || addDays(today(), 2) } : week();
  const lines = shopLines().map(l => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)));
  // Staples that would have been added but were unticked: the worker counts these as skips.
  const skippedStaples = st.staples.filter(s => (w.extras || {})[`staple:${s.id}`] === false && stapleStatus(s, w.deliveryDate) === 'add').map(s => s.id);
  if (trial && !lines.length) throw new Error('The shop is empty. Pick some dinners or add to the list first, so there\'s something to put in the basket.');
  await S.addH(['orders'], {
    week: thisWeekId(), deliveryDate: w.deliveryDate, state: 'requested', lines, skippedStaples: trial ? [] : skippedStaples, meals: trial ? [] : Object.keys(w.picks || {}),
    requestedBy: S.me(), createdAt: S.serverTimestamp(), log: [], ...(trial ? { trial: true } : {}),
  });
  location.hash = '#/order';
});

// ---------- Order ----------
const STEPS = [
  ['requested', 'Starting the order helper'],
  ['logging_in', 'Logging in to Sainsbury\'s'],
  ['need_code', 'Enter the SMS code'],
  ['choose_slot', 'Choose a delivery time'],
  ['filling', 'Filling the basket'],
  ['review', 'Check the total and approve'],
  ['placing', 'Placing the order'],
  ['placed', 'Ordered'],
];
const stateLabel = s => ({ failed: 'Stopped', cancelled: 'Cancelled', needs_you: 'Needs you', trial_done: 'Trial finished' }[s] || (STEPS.find(x => x[0] === s) || [, s])[1]);
const HERO = {
  requested: ['clock', '', 'Starting the order helper', 'Usually within a few minutes. You can close the app; it carries on.'],
  logging_in: ['lock', '', 'Logging in to Sainsbury\'s', 'This takes about a minute.'],
  need_code: ['message', 'warn', 'Enter the SMS code', 'Sainsbury\'s has texted a 6-digit code to the account\'s phone.'],
  choose_slot: ['calendar', 'warn', 'Choose a delivery time', 'Pick one of the free slots below.'],
  filling: ['cart', '', 'Filling the basket', 'Adding everything on the list. This takes a minute or two.'],
  review: ['bag', 'warn', 'Check the total and approve', 'Nothing is paid until you approve.'],
  placing: ['clock', '', 'Placing the order', 'Pressing Place order on Sainsbury\'s checkout.'],
  placed: ['check', '', 'Order placed', 'Staples, meals and the list have been updated.'],
  failed: ['alert', 'danger', 'The order stopped', ''],
  needs_you: ['alert', 'danger', 'The order needs you', ''],
  cancelled: ['x', 'danger', 'Cancelled', ''],
  trial_done: ['check', '', 'Trial finished', ''],
};
function viewOrder() {
  const o = arg ? st.orders.find(x => x.id === arg) : (activeOrder() || st.orders[0]);
  if (!o) return head('Order') + empty('cart', 'No orders yet', 'Build the shop and tap Order to start one.', '<a class="btn primary" href="#/shop">Go to the shop</a>');
  // A stopped order shows how far it got (stoppedAt: the step it was on).
  const idx = STEPS.findIndex(s => s[0] === (['failed', 'needs_you'].includes(o.state) && o.stoppedAt ? o.stoppedAt : o.state));
  const [hic, htone, htitle, hsub] = o.trial && o.state === 'review' ? ['bag', 'warn', 'Check the basket', 'Then tap Check out to try Sainsbury\'s checkout. Nothing is paid.'] : HERO[o.state] || HERO.requested;
  let html = head(`${o.trial ? 'Trial order' : 'Order'} for ${fmtDay(o.deliveryDate, { weekday: 'long', day: 'numeric', month: 'short' })}`, { eyebrow: o.trial ? 'Trial run · nothing is paid' : 'Sainsbury\'s order', sub: `Started by ${esc(o.requestedBy?.name)}${o.slot ? ` · delivery ${fmtTime(o.slot.start_time)}–${fmtTime(o.slot.end_time)}` : ''}` }) + (o.week === thisWeekId() && !o.trial ? flow('order') : '');
  if (o.trial && !DONE_STATES.includes(o.state)) html += `<div class="notice info">${icon('info')}<span class="grow"><b>Trial run.</b> It does everything a real order does up to Sainsbury's Place order button, then stops. Afterwards it takes out what it added and releases the slot.</span></div>`;
  const placedSub = o.state === 'placed' ? `${o.orderNumber ? `Sainsbury's order ${esc(o.orderNumber)}. ` : ''}Staples, meals and the list have been updated.` : hsub;
  html += `<div class="hero"><div class="status"><span class="dot-lg ${htone}">${icon(hic)}</span><span class="grow"><h3>${htitle}</h3>${placedSub ? `<p class="sub">${placedSub}</p>` : ''}</span></div></div>`;
  if (o.message) html += `<div class="notice ${o.state === 'failed' || o.state === 'needs_you' ? 'danger' : ''}">${icon('info')}<span class="grow">${esc(o.message)}</span></div>`;

  if (o.state === 'need_code') {
    html += `<form class="card" data-form="code"><label class="field" style="margin:0">6-digit code
      <input class="code" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" data-keep="sms" required placeholder="······"></label>
      <button class="btn primary lg block" style="margin-top:12px" ${o.smsCode ? 'disabled' : ''}>${o.smsCode ? 'Sent, checking…' : 'Send code'}</button></form>`;
  }
  if (o.state === 'choose_slot') {
    const slots = (o.slots || []);
    const days = [...new Set(slots.map(s => s.date))];
    html += `<div class="card">${o.slotChoice ? '<p class="small muted">Booking it…</p>' : ''}`;
    if (!slots.length) html += `<p class="muted">No free slots around that day.</p>`;
    for (const d of days) {
      html += `<div class="slot-day">${fmtDay(d, { weekday: 'long', day: 'numeric', month: 'short' })}</div><div class="slots">` +
        slots.filter(s => s.date === d).map(s => `<button data-act="slot" data-id="${esc(s.start_time)}" class="${o.slotChoice === s.start_time ? 'on' : ''}" ${o.slotChoice ? 'disabled' : ''}>${fmtTime(s.start_time)}–${fmtTime(s.end_time)}<small>${s.price ? money(s.price) : 'Free'}${s.is_green ? ' · green slot' : ''}</small></button>`).join('') + `</div>`;
    }
    html += `</div>`;
  }
  if (['review', 'placing', 'placed', 'trial_done'].includes(o.state) || (o.basket && o.state === 'failed')) {
    // What needs a decision comes first (not added, offer swaps, things in the
    // basket that weren't in this shop), then the total; the full basket is folded away.
    const b = o.basket || {};
    const missing = (o.lines || []).filter(l => l.result && l.result !== 'added');
    if (missing.length) html += `<div class="notice warn">${icon('alert')}<span class="grow"><b>${missing.length} not added</b><ul class="list compact" style="margin:6px -16px -10px">${missing.map(l => `<li><span class="grow"><span class="name">${esc(l.name)}</span><span class="meta" style="color:inherit;opacity:.8">${esc(l.result === 'not_found' ? 'Not found' : l.result === 'unavailable' ? 'Unavailable' : l.result)}</span></span></li>`).join('')}</ul></span></div>`;
    // Offer swaps: what came in because it's on offer, what it replaced, the saving, and one tap to switch back.
    const swaps = (o.lines || []).filter(l => l.swap && l.result === 'added');
    const undone = (o.lines || []).filter(l => l.undone);
    const asked = new Set(o.undoSwaps || []);
    const canUndo = o.state === 'review';
    if (swaps.length || undone.length) {
      const saved = swaps.reduce((t, l) => t + (l.swap.saving || 0), 0);
      html += section('Swapped for offers', { count: swaps.length, right: saved ? `<span class="price" style="color:var(--ok)">−${money(saved)}</span>` : '' });
      html += `<div class="card flush"><ul class="list">` + swaps.map(l => {
        const waiting = asked.has(l.key) && !l.swap.failed;
        return `<li><span class="grow"><span class="name">${esc(l.product)}${(l.qty || 1) > 1 ? `<span class="qty">×${l.qty}</span>` : ''}</span>
          <span class="meta">On offer${l.swap.offer ? `: <b style="color:var(--warm)">${esc(l.swap.offer)}</b>` : ''} · saves about ${money(l.swap.saving)}</span>
          <span class="meta">Instead of ${esc(l.swap.from)}</span>
          ${l.swap.error ? `<span class="meta" style="color:var(--danger)">${esc(l.swap.error)}</span>` : ''}</span>
          ${canUndo && !l.swap.failed ? `<button class="btn small outline" data-act="undoSwap" data-id="${esc(l.key)}" ${waiting ? 'disabled' : ''}>${waiting ? 'Switching…' : 'Switch back'}</button>` : ''}</li>`;
      }).join('') + undone.map(l => `<li><span class="grow"><span class="name">${esc(l.product)}${(l.qty || 1) > 1 ? `<span class="qty">×${l.qty}</span>` : ''}</span><span class="meta">Switched back from ${esc(l.undone.product)} (the offer would have saved ${money(l.undone.saving)})</span></span><span class="pill">Your usual</span></li>`).join('') + `</ul></div>`;
    }
    // In the basket but not from this shop: left there from before.
    const ours = new Set((o.lines || []).filter(l => l.result === 'added').map(l => String(l.uid)));
    const extra = (b.items || []).filter(i => i.uid != null && !ours.has(String(i.uid)));
    if (extra.length) {
      html += section('Already in the basket', { count: extra.length, right: `<span class="price">${money(extra.reduce((t, i) => t + (i.total || 0), 0))}</span>` });
      html += `<div class="card flush"><p class="small muted" style="margin:0;padding:12px 16px 0">These were in your Sainsbury's basket before and will be ordered too. Take out any you don't want in the Sainsbury's app before approving.</p><ul class="list compact">${extra.map(i => `<li><span class="grow"><span class="name">${esc(i.name)}${i.qty > 1 ? `<span class="qty">×${i.qty}</span>` : ''}</span></span><span class="price">${money(i.total)}</span></li>`).join('')}</ul></div>`;
    }
    html += section('Total');
    html += `<div class="card flush"><div class="totals" style="border-top:0"><div class="row"><span>${plural((b.items || []).length, 'item')}</span><span class="spacer"></span><span class="price">${money(b.subtotal)}</span></div>
      ${b.savings ? `<div class="row"><span>Savings</span><span class="spacer"></span><span class="price" style="color:var(--ok)">−${money(b.savings)}</span></div>` : ''}
      <div class="row"><span>Delivery</span><span class="spacer"></span><span class="price">${money(b.delivery)}</span></div>
      <div class="total"><span>Total</span><span class="price">${money(o.total)}</span></div>
      ${o.card ? `<p class="small muted" style="margin:8px 0 0">${o.trial ? `Sainsbury's checkout showed ${money(o.checkoutTotal)} with ${esc(o.card)}. Nothing was paid.` : `Paid with ${esc(o.card)} on delivery day. Substitutions off.`}</p>` : ''}</div>
      <details class="disclosure" data-toggle="basketOpen" ${keep.basketOpen ? 'open' : ''} style="border-top:1px solid var(--line)"><summary>${icon('bag')} Everything in the basket <span class="count">${(b.items || []).length}</span></summary>
      <ul class="list compact">` + (b.items || []).map(i => `<li><span class="grow"><span class="name">${esc(i.name)}${i.qty > 1 ? `<span class="qty">×${i.qty}</span>` : ''}</span>${i.offer ? `<span class="meta" style="color:var(--warm)">${esc(i.offer)}</span>` : ''}${swaps.some(l => String(l.uid) === String(i.uid)) ? `<span class="meta">Swapped in for an offer</span>` : ''}</span><span class="price">${money(i.total)}</span></li>`).join('') + `</ul></details></div>`;
    if (o.state === 'review') {
      const switching = swaps.some(l => asked.has(l.key) && !l.swap.failed);
      const label = o.approvedBy ? (o.trial ? 'Checking out…' : 'Placing…') : switching ? 'Updating the total…' : o.trial ? `Check out (trial, ${money(o.total)})` : `Approve ${money(o.total)}`;
      html += `<div class="actionbar col"><div><p class="small muted" style="margin:0 0 10px">${o.trial ? 'Goes to Sainsbury\'s checkout and reads the total, but doesn\'t press Place order. Nothing is paid.' : 'Approving places the order with Sainsbury\'s. You can still change it in the Sainsbury\'s app until the cut-off.'}</p>
        <div class="row nowrap"><button class="btn outline danger" data-act="cancelOrder">Cancel</button>
        <button class="btn primary lg" style="flex:1" data-act="approve" ${o.approvedBy || switching ? 'disabled' : ''}>${label}</button></div></div></div>`;
    }
  }
  // Once it's placed, the step-by-step progress is history: tuck it away.
  const stepsHtml = `<ul class="steps">` + STEPS.map(([k, label], i) => { const c = i < idx || o.state === 'placed' ? 'done' : i === idx ? 'now' : ''; return `<li class="${c}"><span class="dot">${c === 'done' ? icon('check') : ''}</span>${label}</li>`; }).join('') + `</ul>`;
  if (!['placed', 'trial_done'].includes(o.state)) html += section('Progress') + `<div class="card flush">${stepsHtml}</div>`;
  if (![...DONE_STATES, 'review'].includes(o.state)) html += `<div class="row end" style="margin-top:4px"><button class="btn small ghost danger" data-act="cancelOrder">Cancel order</button></div>`;
  if (['failed', 'cancelled', 'trial_done'].includes(o.state)) html += o.trial ? `<a class="btn primary block" href="#/week">Back to this week</a>` : `<a class="btn primary block" href="#/shop">Back to the shop to try again</a>`;
  if (o.state === 'placed') html += `<a class="btn primary block" href="#/cook" style="margin-top:12px">${icon('book')} Recipes for these dinners</a><a class="btn outline block" href="#/week" style="margin-top:8px">Back to this week</a>`;
  if (o.log?.length) html += `<details class="card flush disclosure" style="margin-top:12px"><summary>${icon('list')} Details</summary><ul class="list compact small">${o.log.slice(-20).map(l => `<li class="muted">${esc(l)}</li>`).join('')}</ul></details>`;
  return html;
}
const curOrder = () => arg ? st.orders.find(x => x.id === arg) : (activeOrder() || st.orders[0]);
actions.code = f => {
  const code = f.code.value.replace(/\D/g, '');
  if (code.length !== 6) { toast('The code is 6 digits'); return; }
  keep.sms = '';
  run(() => S.updateH(['orders', curOrder().id], { smsCode: code, smsBy: S.me() }));
};
actions.slot = el => run(() => S.updateH(['orders', curOrder().id], { slotChoice: el.dataset.id, slotBy: S.me() }));
actions.undoSwap = el => run(() => S.updateH(['orders', curOrder().id], { undoSwaps: S.arrayUnion(el.dataset.id) }));
actions.approve = () => {
  const o = curOrder();
  if (!confirm(o.trial ? `Go to Sainsbury's checkout for ${money(o.total)}? This is a trial: it won't place the order.` : `Place the order for ${money(o.total)}?`)) return;
  run(() => S.updateH(['orders', o.id], { approvedBy: S.me(), approvedTotal: o.total }));
};
actions.cancelOrder = () => {
  if (!confirm('Cancel this order? The slot is released and the basket is left as it is.')) return;
  run(() => S.updateH(['orders', curOrder().id], { cancelRequested: S.me() }));
};

// ---------- Meals and staples (the household's library) ----------
const libTabs = now => `<div class="seg" role="tablist">${[['meals', 'Meals'], ['staples', 'Staples']].map(([r, l]) => `<a href="#/${r}" role="tab" class="${r === now ? 'on' : ''}" aria-selected="${r === now}">${l}</a>`).join('')}</div>`;
function viewMeals() {
  // Ideas nobody has picked aren't part of the library (see isIdea); they're listed under "Ideas you didn't pick".
  const pickedEver = new Set(Object.values(st.weeks).flatMap(w => Object.keys(w.picks || {})));
  const ideaOnly = m => isIdea(m) && !pickedEver.has(m.id);
  const meals = [...st.meals].filter(m => !m.archived && !ideaOnly(m)).sort((a, b) => (b.timesChosen || 0) - (a.timesChosen || 0) || a.name.localeCompare(b.name));
  let html = libTabs('meals') + head('Meals', { sub: 'Your dinners. Each shop\'s ideas are picked from these and from Claude.', right: `<a class="btn small tonal" href="#/meal/new">${icon('plus')} New</a>` });
  html += `<form class="card" data-form="importLink"><h3 style="display:flex;gap:8px;align-items:center">${icon('link')} Add a recipe from a link</h3>
      <p class="small muted" style="margin:4px 0 12px">Paste a recipe page, or share it to Weekly Shop from your phone. The ingredients are added for you.</p>
      <div class="inputrow"><input type="url" name="url" data-keep="importUrl" placeholder="https://www.bbcgoodfood.com/recipes/…" inputmode="url" autocomplete="off" required aria-label="Recipe link"><button class="btn primary">Add recipe</button></div>
      <label class="row small" style="margin-top:12px;gap:10px"><input type="checkbox" name="week" class="check" checked> Pick it for this week</label></form>
    ${importsHtml()}`;
  if (!meals.length) return html + `<div class="card">${empty('bowl', 'No meals yet', 'Load a starter set of family dinners, or add your own.', '<button class="btn primary" data-act="loadStarter">Load starter meals</button>')}</div>`;
  const inWeek = new Set(week()?.offered || []);
  html += section('All meals', { count: meals.length });
  html += `<div class="search" style="margin-bottom:10px">${icon('search')}<input type="search" placeholder="Search meals" data-keep="mealSearch" data-filter="mealList" aria-label="Search meals"></div>`;
  // Grouped by category, each collapsed until tapped, so a long list stays short.
  const row = m => `<li class="link-row" data-name="${esc(m.name.toLowerCase())}">${tile(m, 'sm')}<a href="#/meal/${m.id}" class="grow">
      <span class="name">${esc(m.name)}</span><span class="meta">${plural((m.ingredients || []).length, 'ingredient')}${m.ingredientsBy === 'claude' ? ' (from Claude)' : ''}${m.timesChosen ? ` · picked ${m.timesChosen}×` : ''}${m.lastChosen ? `, last ${fmtDay(m.lastChosen)}` : ''}</span></a>
      ${week() && !inWeek.has(m.id) ? `<button class="btn small outline" data-act="offer" data-id="${m.id}">Add to this week</button>` : inWeek.has(m.id) ? '<span class="pill ok">In this week\'s ideas</span>' : ''}</li>`;
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
    <p class="small muted" style="margin:0;padding:0 16px 8px">Suggested by Claude or your recipe sites. They join your meals once picked, or add one now.</p><ul class="list">${pastIdeas.map(m => `<li>${tile(m, 'sm')}<a href="#/recipe/${esc(m.id)}" class="grow"><span class="name">${esc(m.name)}</span><span class="meta">${esc(m.addedBy?.name ? `From ${m.addedBy.name}` : 'Idea')}${m.lastOffered ? ` · offered week of ${fmtDay(m.lastOffered, { day: 'numeric', month: 'short' })}` : ''}</span></a>
    <button class="btn small outline" data-act="keepIdea" data-id="${esc(m.id)}">Add to meals</button></li>`).join('')}</ul></details>`;
  const archived = st.meals.filter(m => m.archived);
  if (archived.length) html += `<details class="card flush disclosure" style="margin-top:12px"><summary>Removed meals <span class="count">${archived.length}</span></summary><ul class="list">${archived.map(m => `<li><span class="grow">${esc(m.name)}</span><button class="btn small outline" data-act="unarchive" data-id="${m.id}">Restore</button></li>`).join('')}</ul></details>`;
  return html;
}
function importsHtml() {
  const recent = st.imports.filter(i => i.state !== 'done' || (i.doneAt && Date.now() - i.doneAt.toMillis() < 864e5)).slice(0, 5);
  if (!recent.length) return '';
  return `<div class="card flush"><ul class="list">` + recent.map(i => `<li>${i.state === 'requested' || i.state === 'reading' ? '<span class="spinner" style="flex:none"></span>' : i.state === 'failed' ? `<span class="tile sm meat">${icon('alert')}</span>` : `<span class="tile sm veg">${icon('check')}</span>`}
    <span class="grow"><span class="name">${esc(i.name || i.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</span>
    <span class="meta">${i.state === 'requested' || i.state === 'reading' ? 'Reading the recipe…' : i.state === 'failed' ? esc(i.message || 'Couldn\'t read it') : `${i.count} ingredients added${i.addToWeek ? ', picked for this week' : ''}`}</span></span>
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
function takeSharedLink() {
  if (!sharedLink || !st.household?.members) return;
  const url = sharedLink; sharedLink = null;
  run(() => importLink(url, true), 'Recipe link added. It\'ll appear in a moment');
}

actions.offer = el => run(() => S.setH(['weeks', thisWeekId()], { offered: [...(week().offered || []), el.dataset.id] }), 'Added to this week');
actions.keepIdea = el => run(() => S.updateH(['meals', el.dataset.id], { idea: false }), 'Added to your meals');
actions.unarchive = el => run(() => S.updateH(['meals', el.dataset.id], { archived: false }));

function viewMeal() {
  const m = arg === 'new' ? { name: '', ingredients: [] } : mealById(arg);
  if (!m) return empty('bowl', 'Meal not found', 'It may have been removed.', '<a class="btn" href="#/meals">Back to meals</a>');
  const lines = (m.ingredients || []).map(i => `${i.item}${i.qty > 1 ? ` x${i.qty}` : ''}${i.pantry ? ' (cupboard)' : ''}${i.search && ![i.item.toLowerCase(), `sainsburys ${i.item.toLowerCase()}`].includes(i.search.toLowerCase()) ? ` | ${i.search}` : ''}`).join('\n');
  return `<a class="btn small ghost" href="#/meals" style="margin:8px 0 0 -6px">${icon('back')} Meals</a>
    ${head(arg === 'new' ? 'Add a meal' : 'Edit meal', { right: arg === 'new' ? '' : tile(m) })}
    <form class="card" data-form="saveMeal">
      <label class="field">Name<input type="text" name="name" value="${esc(m.name)}" required data-keep="mealName"></label>
      ${m.source ? `<p class="small muted">${icon('link')} From <a href="${esc(m.source)}" target="_blank" rel="noopener">${esc(m.source.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a></p>` : ''}
      ${arg === 'new' ? '' : `<p class="small"><a href="#/recipe/${esc(m.id)}">${icon('book')} View the recipe and method</a></p>`}
      <label class="field">Category<select name="category" data-keep="mealCat">
        <option value="">Automatic${m.name ? ` (${MEAL_CATEGORIES.find(c => c[0] === autoCategory(m))[1]})` : ''}</option>
        ${MEAL_CATEGORIES.map(([k, l]) => `<option value="${k}"${m.category === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Ingredients<span class="hint">One per line. Add “x2” for two, “(cupboard)” for things you usually have, and “| search words” to pick the exact Sainsbury's product.</span>
        <textarea name="ingredients" rows="10" placeholder="Chicken thighs x2&#10;Lemons | sainsburys unwaxed lemons" data-keep="mealIng">${esc(lines)}</textarea></label>
      ${m.ingredientsBy === 'claude' ? `<p class="small muted">${icon('sparkle')} Ingredients suggested by Claude. Check them over.</p>` : ''}
      <div class="row nowrap"><button class="btn primary lg" style="flex:1">Save</button>
      ${arg === 'new' ? '' : '<button type="button" class="btn lg outline danger" data-act="archiveMeal">Remove</button>'}</div>
    </form>`;
}
actions.saveMeal = f => {
  const ingredients = f.ingredients.value.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    let [left, search] = line.split('|').map(s => s.trim());
    const pantry = /\(cupboard\)/i.test(left);
    left = left.replace(/\s*\(cupboard\)\s*/i, ' ').trim();
    const m = left.match(/^(.*?)\s*(?:x|×)\s*(\d+)$/i);
    const item = m ? m[1] : left;
    return { item, qty: m ? +m[2] : 1, search: search || item, ...(pantry ? { pantry: true } : {}) };
  });
  const data = { name: f.name.value.trim(), ingredients };
  const category = f.category.value;
  keep = {};
  run(async () => {
    if (arg === 'new') await S.addH(['meals'], { ...data, ...(category ? { category } : {}), timesChosen: 0, createdAt: S.serverTimestamp() });
    else await S.updateH(['meals', arg], { ...data, category: category || S.deleteField() });
    location.hash = '#/meals';
  }, 'Saved');
};
actions.archiveMeal = () => run(async () => { await S.updateH(['meals', arg], { archived: true }); location.hash = '#/meals'; });

// ---------- Staples ----------
function viewStaples() {
  const d = deliveryDate() || addDays(today(), 2);
  const groups = [['add', 'Due this shop'], ['suggest', 'For meals, when needed'], ['not_due', 'Not due yet'], ['lapsed', 'Not bought lately'], ['dropped', 'Turned off']];
  const rows = st.staples.map(s => ({ s, status: stapleStatus(s, d) }));
  let html = libTabs('staples') + head('Staples', { sub: `Things you buy regularly, learned from your orders. The ones due go in the shop for ${fmtDay(d)} automatically. Switch one off to stop buying it.` });
  if (!rows.length) return html + `<div class="card">${empty('layers', 'No staples yet', 'Import them from your order history in Settings.', '<a class="btn primary" href="#/settings">Open Settings</a>')}</div>`;
  html += `<div class="search" style="margin-bottom:4px">${icon('search')}<input type="search" placeholder="Search staples" data-keep="stapleSearch" data-filter="stapleList" aria-label="Search staples"></div>`;
  html += `<div id="stapleList">`;
  for (const [status, title] of groups) {
    const g = rows.filter(r => r.status === status).sort((a, b) => a.s.name.localeCompare(b.s.name));
    if (!g.length) continue;
    html += `<div data-group="${status}">${section(title, { count: g.length })}<div class="card flush"><ul class="list">` + g.map(({ s }) => `<li data-name="${esc(s.name.toLowerCase())}"><span class="grow"><span class="name">${esc(s.name)}${(s.quantity || 1) > 1 ? `<span class="qty">×${s.quantity}</span>` : ''}</span>
      <span class="meta">${skipRule(s) === 'every_week' ? 'Every week' : s.every_days ? `About every ${s.every_days} days` : ''}${s.last_bought ? ` · last ${fmtDay(s.last_bought)}` : ''}${s.skips ? ` · left out ${s.skips}× running` : ''}</span>
      ${s.learned && s.skips >= 3 ? `<span class="meta" style="color:var(--warm)">${esc(s.learned)} · <button class="link" data-act="resetSkips" data-id="${s.id}">Undo</button></span>` : ''}
      ${s.freqNote ? `<span class="meta" style="color:var(--ok)">${esc(s.freqNote)}</span>` : ''}
      ${st.household.cheaperSwaps === false ? '' : `<span class="meta">${s.keep ? 'Always this one, never swapped · ' : ''}<button class="link" data-act="keepStaple" data-id="${s.id}">${s.keep ? 'Allow cheaper swaps' : 'Always this one'}</button></span>`}
      ${s.times_bought ? `<details class="mini" data-toggle="hist-${s.id}"><summary>Bought ${s.times_bought}×${(s.history || []).length ? ', see when' : ''}</summary>${(s.history || []).length ? `<span class="meta">${[...s.history].reverse().map(x => `${fmtDay(x.date)}${x.qty > 1 ? ` ×${x.qty}` : ''}`).join(' · ')}</span>` : '<span class="meta">Dates are logged from your first order in the app.</span>'}</details>` : ''}</span>
      <input type="checkbox" class="switch" data-change="dropStaple" data-id="${s.id}" ${s.dropped ? '' : 'checked'} aria-label="${s.dropped ? 'Turn on' : 'Turn off'} ${esc(s.name)}"></li>`).join('') + `</ul></div></div>`;
  }
  return html + `</div>`;
}
actions.resetSkips = el => run(() => S.updateH(['staples', el.dataset.id], { skips: 0, learned: S.deleteField(), skipped_on: S.deleteField() }));
actions.keepStaple = el => run(() => { const s = st.staples.find(x => x.id === el.dataset.id); return S.updateH(['staples', s.id], { keep: !s.keep }); }, 'Saved');
actions.dropStaple = el => run(() => { const s = st.staples.find(x => x.id === el.dataset.id); return S.updateH(['staples', s.id], { dropped: !s.dropped }); });

// ---------- Settings ----------
function viewSettings() {
  const h = st.household;
  const link = `${location.origin}${location.pathname}?join=${h.inviteCode}`;
  const iphoneNotInstalled = /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone;
  return `${head('Settings', { eyebrow: esc(h.name) })}
    ${section('Household')}
    <div class="card"><div class="row nowrap" style="gap:12px;margin-bottom:14px"><span class="who" style="margin:0">${Object.entries(h.memberNames || {}).map(([uid, name]) => avatar({ uid, name })).join('')}</span>
      <span class="grow"><b>${esc(h.name)}</b><br><span class="small muted">${Object.values(h.memberNames || {}).map(esc).join(', ')}</span></span></div>
      <label class="field" style="margin-bottom:10px">Invite link<span class="hint">Whoever opens it and signs in joins this household.</span>
      <input type="text" readonly value="${esc(link)}" onclick="this.select()"></label>
      <div class="row"><button class="btn primary" data-act="share" data-id="${esc(link)}">${icon('users')} Share invite link</button>
      <button class="btn ghost" data-act="newInvite">Make a new link</button></div>
      <p class="tiny muted" style="margin-top:10px">A new link stops the old one working. People already in stay in.</p>
      <div class="row nowrap" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><span class="grow"><b>Cooking for</b><br><span class="small muted">Recipes and their shop amounts are scaled to this. Change it on a recipe for one meal.</span></span>
        <span class="stepper"><button class="step" data-act="serves" data-id="-1" aria-label="Fewer people">${icon('minus')}</button><b>${householdServes()}</b><button class="step" data-act="serves" data-id="1" aria-label="More people">${icon('plus')}</button></span></div></div>

    ${section('Notifications')}
    <div class="card"><div class="row nowrap" style="gap:12px;align-items:flex-start"><span class="tile sm other">${icon('bell')}</span><span class="grow">
      <b>Notifications on this phone</b><p class="small muted" style="margin:2px 0 0">When Sainsbury's needs the SMS code, when there are slots to pick, and when the basket is ready to approve. Each person turns it on on their own phone.</p></span></div>
      ${iphoneNotInstalled ? `<div class="notice info" style="margin:12px 0 0">${icon('info')}<span class="grow">On iPhone, add Weekly Shop to your home screen first (Share › Add to Home Screen) and turn this on from there.</span></div>` : ''}
      <div style="margin-top:12px">${S.notificationsOn() ? `<div class="row"><span class="chip ok">${icon('check')} On for this phone</span><span class="spacer"></span><button class="btn small outline" data-act="notifyOff">Turn off</button></div>` : `<button class="btn tonal block" data-act="notifyOn">${icon('bell')} Turn on notifications</button>`}</div></div>

    ${section('Order helper')}
    <div class="card"><b>Trial run</b><p class="small muted" style="margin:2px 0 12px">Checks the whole Sainsbury's order works without buying anything: it logs in (you'll need the SMS code), books a slot, fills the basket with this week's shop, goes to checkout and reads the total, then stops before Place order. Afterwards it takes out what it added and releases the slot.</p>
      ${activeOrder() ? `<a class="btn outline block" href="#/order">An order is running: view it</a>` : `<button class="btn tonal block" data-act="trialOrder">${icon('cart')} Start a trial run</button>`}</div>

    ${section('Prices')}
    <div class="card"><div class="row nowrap" style="gap:12px;align-items:flex-start"><span class="grow"><b>Cheaper swaps</b><p class="small muted" style="margin:2px 0 0">When the basket is filled, swap to a product that's on offer if it's the cheapest of products that are the same thing (same quality, organic or free range kept, brand kept where it matters), going by price per kg, litre or item with offers, Nectar prices and multibuys counted. The swaps are listed before you approve. Your notes below are followed, for example “always Heinz beans”.</p></span>
      <input type="checkbox" class="switch" data-change="cheaperSwaps" ${h.cheaperSwaps === false ? '' : 'checked'} aria-label="Cheaper swaps"></div></div>

    ${section('Claude')}
    <form class="card" data-form="saveNotes"><label class="field" style="margin-bottom:10px">About your household<span class="hint">Claude reads this when it picks the week's ideas and checks for cheaper swaps: who's eating, dislikes, allergies, how adventurous to be, brands you always buy.</span>
      <textarea name="notes" rows="4" data-keep="notes" placeholder="2 adults, children aged 5 and 7. Mild spice for the kids. No mushrooms.">${esc(h.notes || '')}</textarea></label>
      <button class="btn small primary">Save</button></form>

    ${section('Recipe sites')}
    <div class="card"><p class="small muted">Each week, one of the ideas is a recipe published in the last 7 days on each of these sites. Add a recipe site's address (or its RSS feed).</p>
      ${sources().map((s, i) => { const st2 = (h.recipeSourceStatus || []).find(x => x.url === s.url); return `<div class="row nowrap" style="margin-bottom:10px;padding:10px 12px;border-radius:12px;background:var(--surface-2)">${icon('link')}<span class="grow small"><b>${esc(s.name || hostOf(s.url))}</b><br><span class="muted">${esc(hostOf(s.url))}${st2 ? ` · ${st2.ok ? '' : 'Last try failed: '}${esc(st2.note)}` : ''}</span></span><button class="btn small ghost danger" data-act="delSource" data-id="${i}">Remove</button></div>`; }).join('')}
      ${sources().length < 5 ? `<form data-form="addSource" class="row"><input type="text" name="url" required style="flex:2 1 160px" placeholder="bbcgoodfood.com" aria-label="Recipe site address" inputmode="url" autocapitalize="off"><input type="text" name="name" placeholder="Name (optional)" aria-label="Name" style="flex:1 1 120px"><button class="btn primary">Add</button></form>` : ''}</div>

    ${section('Holiday mode')}
    <div class="card"><p class="small muted">Add the dates you're away. Delivery days in that time can't be picked.</p>
      ${(h.away || []).filter(a => a.to >= today()).map(a => `<div class="row nowrap" style="margin-bottom:10px;padding:10px 12px;border-radius:12px;background:var(--surface-2)">${icon('plane')}<span class="grow small"><b>${fmtDay(a.from, { weekday: 'short', day: 'numeric', month: 'short' })} – ${fmtDay(a.to, { weekday: 'short', day: 'numeric', month: 'short' })}</b></span><button class="btn small ghost danger" data-act="delAway" data-id="${esc(a.from)}|${esc(a.to)}">Remove</button></div>`).join('')}
      <form data-form="addAway" class="row nowrap"><input type="date" name="from" required aria-label="From"><input type="date" name="to" required aria-label="To"><button class="btn primary">Add</button></form></div>

    ${section('Data')}
    <div class="card"><b>Import order history</b><p class="small muted" style="margin:2px 0 10px">Load staples and meal history from a seed file made from your Sainsbury's orders.</p>
      <input type="file" accept="application/json" data-change="importFile"></div>

    ${section('Account')}
    <div class="card"><div class="row nowrap"><span class="grow small"><span class="muted">Signed in as</span><br><b>${esc(st.user.email)}</b></span><button class="btn outline" data-act="signOut">${icon('logout')} Sign out</button></div></div>`;
}
actions.serves = el => run(() => S.updateH([], { serves: Math.max(1, Math.min(20, householdServes() + Number(el.dataset.id))) }));
actions.trialOrder = () => { if (confirm('Start a trial run? You\'ll need the SMS code from Sainsbury\'s. Nothing is bought.')) startOrder(true); };
actions.notifyOn = () => run(async () => { await S.enableNotifications(); render(); }, 'Notifications are on for this phone');
actions.notifyOff = () => run(async () => { await S.disableNotifications(); render(); }, 'Notifications are off for this phone');
actions.cheaperSwaps = el => run(() => S.updateH([], { cheaperSwaps: el.checked }), el.checked ? 'Cheaper swaps on' : 'Cheaper swaps off');
actions.saveNotes = f => { const notes = f.notes.value.trim().slice(0, 1000); delete keep.notes; run(() => S.updateH([], { notes }), 'Saved'); };
// Recipe sites (see worker/feeds.mjs). Never set means the Guardian's recipes.
const GUARDIAN = { name: 'The Guardian', url: 'https://www.theguardian.com/tone/recipes/rss' };
const sources = () => Array.isArray(st.household.recipeSources) ? st.household.recipeSources : [GUARDIAN];
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
actions.addSource = f => {
  let url = f.url.value.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try { url = new URL(url).href; } catch { toast('That doesn\'t look like a web address'); return; }
  if (sources().some(s => s.url === url)) { toast('That site is already on the list'); return; }
  const name = f.name.value.trim().slice(0, 40) || hostOf(url);
  run(() => S.updateH([], { recipeSources: [...sources(), { name, url }] }), 'Added. It\'s used from the next ideas.');
};
actions.delSource = el => run(() => S.updateH([], { recipeSources: sources().filter((_, i) => i !== +el.dataset.id) }));
actions.addAway = f => {
  const from = f.from.value, to = f.to.value;
  if (!from || !to || to < from) { toast('Pick a start date and an end date after it'); return; }
  run(() => S.updateH([], { away: [...(st.household.away || []).filter(a => a.to >= today()), { from, to }].sort((a, b) => a.from.localeCompare(b.from)) }), 'Holiday added');
};
actions.delAway = el => { const [from, to] = el.dataset.id.split('|'); run(() => S.updateH([], { away: (st.household.away || []).filter(a => !(a.from === from && a.to === to)) })); };
actions.share = el => {
  const url = el.dataset.id;
  if (navigator.share) navigator.share({ title: 'Weekly Shop', text: 'Join our weekly shop', url }).catch(() => {});
  else navigator.clipboard?.writeText(url).then(() => toast('Link copied'));
};
actions.newInvite = () => run(S.newInviteCode, 'New link made');
actions.importFile = el => run(async () => {
  const file = el.files[0]; if (!file) return;
  const seed = JSON.parse(await file.text());
  const ops = [];
  if (seed.products) ops.push(['set', ['meta', 'products'], { items: seed.products }]);
  for (const s of seed.staples || []) ops.push(['set', ['staples', String(s.product_uid)], s]);
  const byName = new Map(st.meals.map(m => [m.name.toLowerCase(), m]));
  for (const m of seed.meals || []) {
    const have = byName.get(m.name.toLowerCase());
    if (have) ops.push(['set', ['meals', have.id], { timesChosen: m.timesChosen || 0, lastChosen: m.lastChosen || null }]);
    else ops.push(['add', ['meals'], { ...m, createdAt: S.serverTimestamp() }]);
  }
  await S.batchH(ops);
  el.value = '';
}, 'Imported');

if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('online', render); window.addEventListener('offline', render);
render();
