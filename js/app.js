import * as S from './store.js';
import { weekId, iso, addDays, buildShop, stapleStatus, pickIdeas, awayOn, awayWeek, skipRule, matchUsual } from './plan.js';
import { icon, tile, avatar } from './ui.js';

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
const routes = { week: viewWeek, list: viewList, shop: viewShop, order: viewOrder, meals: viewMeals, meal: viewMeal, staples: viewStaples, settings: viewSettings };
let route = 'week', arg = null;
function parseHash() {
  const [, r = 'week', a = null] = (location.hash || '#/week').split('/');
  route = routes[r] ? r : 'week'; arg = a && decodeURIComponent(a);
}
window.addEventListener('hashchange', () => { parseHash(); keep = {}; render(); window.scrollTo(0, 0); });
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
  const tab = { shop: 'week', order: 'week', meal: 'meals', staples: 'meals' }[route] || route;
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
$main.addEventListener('input', e => { const el = e.target; if (el.dataset?.keep) keep[el.dataset.keep] = el.value; if (el.dataset?.filter) applyFilter(el); });
// Search boxes filter the rows of the list they name, without a re-render.
function applyFilter(el) {
  const q = el.value.trim().toLowerCase();
  const root = document.getElementById(el.dataset.filter);
  if (!root) return;
  root.querySelectorAll('li[data-name]').forEach(li => { li.hidden = !!q && !li.dataset.name.includes(q); });
  // In a grouped list, hide a group whose rows are all filtered out.
  root.querySelectorAll('[data-group]').forEach(g => { g.hidden = !!q && !g.querySelector('li[data-name]:not([hidden])'); });
}

// ---------- sign in & household ----------
const GOOGLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>';
function viewSignIn() {
  const f = (ic, kind, title, text) => `<li>${`<span class="tile ${kind}">${icon(ic)}</span>`}<span class="grow"><b>${title}</b><span>${text}</span></span></li>`;
  return `<div class="signin"><img class="logo" src="icon.svg" alt="">
    <h1>Weekly Shop</h1><p class="lede">Plan the week's dinners together and send one shop to Sainsbury's.</p>
    <ul class="list card features">
      ${f('sparkle', 'other', 'Meal ideas that learn', 'Ten ideas each Sunday, shaped by what you pick.')}
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
const activeOrder = () => st.orders.find(o => !['placed', 'failed', 'cancelled'].includes(o.state));
const deliveryDate = () => week()?.deliveryDate || null;
const pickedMeals = () => Object.keys(week()?.picks || {}).map(mealById).filter(Boolean);
const TARGET = 5;
// This week's order, running or placed.
const weekOrder = () => activeOrder() || st.orders.find(o => o.state === 'placed' && o.week === thisWeekId());
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
  let html = head('This week', { eyebrow: `Week of ${fmtDay(thisWeekId(), { day: 'numeric', month: 'long' })}`, sub: wo ? '' : `Pick ${TARGET} dinners and a delivery day. The shop is worked out from them.` }) + flow('week');
  // A running or placed order is shown once, in the bar at the bottom.

  const away = st.household.away || [];
  const nowAway = awayOn(away, today()) || (awayWeek(away, thisWeekId()) && away.find(a => a.to >= today()));
  if (nowAway) html += `<div class="notice warn">${icon('plane')}<span class="grow"><b>Holiday mode</b> · away ${fmtDay(nowAway.from)} to ${fmtDay(nowAway.to)}. Sunday ideas are paused for weeks you're away. <a href="#/settings">Change</a></span></div>`;
  if (!st.meals.length) {
    return html + `<div class="card">${empty('bowl', 'No meals yet', 'Load a starter set of family dinners to get going. You can edit them and add your own.', '<button class="btn primary" data-act="loadStarter">Load starter meals</button>')}</div>`;
  }
  if (!w?.offered?.length) {
    if (w?.ideasRequested) return html + `<div class="card">${empty('sparkle', 'Claude is choosing this week\'s ideas', 'They\'ll appear here in a minute or two.', '<span class="spinner" style="display:inline-block"></span>')}</div>`;
    return html + `<div class="card">${empty('sparkle', 'No ideas yet this week', 'Ideas are made every Sunday morning. You can make them now.',
      `<div class="row" style="justify-content:center"><button class="btn primary" data-act="askClaude">${icon('sparkle')} Ask Claude for ideas</button><button class="btn" data-act="makeIdeas">Pick from our meals now</button></div>`)}</div>`;
  }
  const picks = w.picks || {};
  const n = Object.keys(picks).length;
  // How many are picked is shown once, in the bar at the bottom.
  html += section('1. Pick your dinners', { right: `<span class="small muted">${w.ideasBy === 'claude' ? 'Ideas by Claude' : 'From your meals'}</span>` });
  w.offered.forEach(id => {
    const m = mealById(id); if (!m) return;
    const p = picks[id];
    const tag = w.from?.[id] && !m.timesChosen ? `<span class="chip new">${icon('link')} New on ${esc(w.from[id])}</span>` : m.timesChosen ? `<span class="chip fav">${icon('star')} Picked ${m.timesChosen}×</span>` : m.addedBy?.name === 'Claude' ? `<span class="chip new">${icon('sparkle')} New from Claude</span>` : '<span class="chip">New</span>';
    html += `<button class="meal${p ? ' on' : ''}" data-act="pick" data-id="${esc(id)}" aria-pressed="${p ? 'true' : 'false'}">
      ${tile(m)}
      <span class="grow"><span class="title">${esc(m.name)}</span>
      ${w.reasons?.[id] ? `<span class="why">${esc(w.reasons[id])}</span>` : ''}
      <span class="chips">${tag}${/^https?:\/\//.test(m.source || '') ? `<span class="chip link" data-act="openRecipe" data-id="${esc(m.source)}" role="link" title="Open the recipe on ${esc(hostOf(m.source))}">${icon('link')} Open recipe</span>` : ''}${m.cuisine ? `<span class="chip outline">${esc(m.cuisine)}</span>` : ''}${p ? `<span class="chip ok">${avatar(p, 'sm')} ${esc(p.name?.split(' ')[0] || '')}</span>` : ''}</span></span>
      <span class="tick">${icon('check')}</span></button>`;
  });
  html += `<div class="toolbar">
    <button class="btn small tonal" data-act="askClaude" ${w.ideasRequested ? 'disabled' : ''}>${icon('sparkle')} ${w.ideasRequested ? 'Claude is thinking…' : 'Ask Claude for fresh ideas'}</button>
    <button class="btn small outline" data-act="remakeIdeas">${icon('shuffle')} Swap the unpicked ones</button>
    <button class="btn small outline" data-act="addIdea">${icon('plus')} Add another meal</button></div>`;

  html += section('2. Choose a delivery day');
  html += `<div class="days">`;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today(), i);
    const off = awayOn(away, d);
    html += `<button data-act="day" data-id="${d}" class="${w.deliveryDate === d ? 'on' : ''}" ${off ? 'disabled title="Away"' : ''} aria-pressed="${w.deliveryDate === d}"><small>${fmtDay(d, { weekday: 'short' })}</small><b>${fmtDay(d, { day: 'numeric' })}</b><span>${off ? 'Away' : fmtDay(d, { month: 'short' })}</span></button>`;
  }
  html += `</div>`;
  html += wo
    ? `<div class="actionbar"><div><span class="sum"><b>${wo.state === 'placed' ? 'Ordered' : activeOrder() && ['need_code', 'choose_slot', 'review', 'needs_you'].includes(wo.state) ? 'The order needs you' : 'Order in progress'}</b><span>${esc(orderLine(wo))}</span></span><a class="btn primary" href="#/order">View order ${icon('chevron')}</a></div></div>`
    : `<div class="actionbar"><div><span class="sum"><b>${n} of ${TARGET} dinners</b><span>${w.deliveryDate ? `Delivery ${fmtDay(w.deliveryDate)}` : 'Choose a delivery day'}</span></span>
    <a class="btn primary" href="#/shop">Next: the shop ${icon('chevron')}</a></div></div>`;
  return html;
}
// The "Open recipe" chip sits inside the meal's pick button; the click handler finds the chip first, so it doesn't pick.
actions.openRecipe = el => { if (/^https?:\/\//.test(el.dataset.id)) window.open(el.dataset.id, '_blank', 'noopener'); };
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
  return S.updateH(['weeks', thisWeekId()], { [`picks.${id}`]: picks[id] ? S.deleteField() : S.me() });
});
actions.day = el => run(() => S.setH(['weeks', thisWeekId()], { deliveryDate: el.dataset.id }));
actions.addIdea = () => { location.hash = '#/meals'; };

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
  return buildShop({ staples: st.staples, meals: pickedMeals(), list, delivery: w.deliveryDate || addDays(today(), 2), extras: w.extras || {} });
}
const lineRow = l => `<li><input type="checkbox" class="check" checked data-change="lineOff" data-id="${esc(l.key)}" aria-label="Include">
  <span class="grow"><span class="name">${esc(l.name)}${l.qty > 1 ? `<span class="qty">×${l.qty}</span>` : ''}</span>${l.product ? `<span class="meta">${esc(l.product)}</span>` : ''}${l.for ? `<span class="meta">${esc(l.for.join(' · '))}</span>` : ''}</span></li>`;
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
  html += list.length ? `<div class="card flush"><ul class="list inset-check">${list.map(lineRow).join('')}</ul></div>` : `<div class="card soft"><p class="small muted">Nothing on the list. <a href="#/list">Add something</a>.</p></div>`;

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
actions.lineOn = el => run(() => setExtra(el.dataset.id, true));
actions.order = () => run(async () => {
  if (activeOrder()) { location.hash = '#/order'; return; }
  const w = week();
  const lines = shopLines().map(l => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)));
  // Staples that would have been added but were unticked: the worker counts these as skips.
  const skippedStaples = st.staples.filter(s => (w.extras || {})[`staple:${s.id}`] === false && stapleStatus(s, w.deliveryDate) === 'add').map(s => s.id);
  await S.addH(['orders'], {
    week: thisWeekId(), deliveryDate: w.deliveryDate, state: 'requested', lines, skippedStaples, meals: Object.keys(w.picks || {}),
    requestedBy: S.me(), createdAt: S.serverTimestamp(), log: [],
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
const stateLabel = s => ({ failed: 'Stopped', cancelled: 'Cancelled', needs_you: 'Needs you' }[s] || (STEPS.find(x => x[0] === s) || [, s])[1]);
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
};
function viewOrder() {
  const o = arg ? st.orders.find(x => x.id === arg) : (activeOrder() || st.orders[0]);
  if (!o) return head('Order') + empty('cart', 'No orders yet', 'Build the shop and tap Order to start one.', '<a class="btn primary" href="#/shop">Go to the shop</a>');
  const idx = STEPS.findIndex(s => s[0] === o.state);
  const [hic, htone, htitle, hsub] = HERO[o.state] || HERO.requested;
  let html = head(`Order for ${fmtDay(o.deliveryDate, { weekday: 'long', day: 'numeric', month: 'short' })}`, { eyebrow: 'Sainsbury\'s order', sub: `Started by ${esc(o.requestedBy?.name)}${o.slot ? ` · delivery ${fmtTime(o.slot.start_time)}–${fmtTime(o.slot.end_time)}` : ''}` }) + (o.week === thisWeekId() ? flow('order') : '');
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
  if (['review', 'placing', 'placed'].includes(o.state) || (o.basket && o.state === 'failed')) {
    const b = o.basket || {};
    const missing = (o.lines || []).filter(l => l.result && l.result !== 'added');
    if (missing.length) html += `<div class="notice warn">${icon('alert')}<span class="grow"><b>${missing.length} not added</b><ul class="list compact" style="margin:6px -16px -10px">${missing.map(l => `<li><span class="grow"><span class="name">${esc(l.name)}</span><span class="meta" style="color:inherit;opacity:.8">${esc(l.result === 'not_found' ? 'Not found' : l.result === 'unavailable' ? 'Unavailable' : l.result)}</span></span></li>`).join('')}</ul></span></div>`;
    const swaps = (o.lines || []).filter(l => l.swap && l.result === 'added');
    if (swaps.length) {
      const saved = swaps.reduce((t, l) => t + (l.swap.saving || 0), 0);
      html += `<details class="card flush disclosure" data-toggle="swapsOpen" ${keep.swapsOpen ? 'open' : ''}><summary>${icon('tag')} ${plural(swaps.length, 'cheaper swap')}, about ${money(saved)} less</summary><ul class="list compact">${swaps.map(l => `<li><span class="grow"><span class="name">${esc(l.product)}</span><span class="meta">Instead of ${esc(l.swap.from)}${l.swap.offer ? ` · <span style="color:var(--warm)">${esc(l.swap.offer)}</span>` : ''}</span></span><span class="price" style="color:var(--ok)">−${money(l.swap.saving)}</span></li>`).join('')}</ul><p class="tiny muted" style="margin:0;padding:0 16px 12px">Same thing, on offer this week, for less per kg, litre or item. Remove any you don't want in the Sainsbury's app, or set a staple to “Always this one”.</p></details>`;
    }
    html += section('Basket', { count: (b.items || []).length });
    html += `<div class="card flush"><ul class="list compact">` + (b.items || []).map(i => `<li><span class="grow"><span class="name">${esc(i.name)}${i.qty > 1 ? `<span class="qty">×${i.qty}</span>` : ''}</span>${i.offer ? `<span class="meta" style="color:var(--warm)">${esc(i.offer)}</span>` : ''}</span><span class="price">${money(i.total)}</span></li>`).join('') + `</ul>
      <div class="totals"><div class="row"><span>Items</span><span class="spacer"></span><span class="price">${money(b.subtotal)}</span></div>
      ${b.savings ? `<div class="row"><span>Savings</span><span class="spacer"></span><span class="price" style="color:var(--ok)">−${money(b.savings)}</span></div>` : ''}
      <div class="row"><span>Delivery</span><span class="spacer"></span><span class="price">${money(b.delivery)}</span></div>
      <div class="total"><span>Total</span><span class="price">${money(o.total)}</span></div>
      ${o.card ? `<p class="small muted" style="margin:8px 0 0">Paid with ${esc(o.card)} on delivery day. Substitutions off.</p>` : ''}</div></div>`;
    if (o.state === 'review') {
      html += `<div class="actionbar col"><div><p class="small muted" style="margin:0 0 10px">Approving places the order with Sainsbury's. You can still change it in the Sainsbury's app until the cut-off.</p>
        <div class="row nowrap"><button class="btn outline danger" data-act="cancelOrder">Cancel</button>
        <button class="btn primary lg" style="flex:1" data-act="approve" ${o.approvedBy ? 'disabled' : ''}>${o.approvedBy ? 'Placing…' : `Approve ${money(o.total)}`}</button></div></div></div>`;
    }
  }
  // Once it's placed, the step-by-step progress is history: tuck it away.
  const stepsHtml = `<ul class="steps">` + STEPS.map(([k, label], i) => { const c = i < idx || o.state === 'placed' ? 'done' : i === idx ? 'now' : ''; return `<li class="${c}"><span class="dot">${c === 'done' ? icon('check') : ''}</span>${label}</li>`; }).join('') + `</ul>`;
  if (o.state !== 'placed') html += section('Progress') + `<div class="card flush">${stepsHtml}</div>`;
  if (!['placed', 'failed', 'cancelled', 'review'].includes(o.state)) html += `<div class="row end" style="margin-top:4px"><button class="btn small ghost danger" data-act="cancelOrder">Cancel order</button></div>`;
  if (['failed', 'cancelled'].includes(o.state)) html += `<a class="btn primary block" href="#/shop">Back to the shop to try again</a>`;
  if (o.state === 'placed') html += `<a class="btn outline block" href="#/week" style="margin-top:12px">Back to this week</a>`;
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
actions.approve = () => {
  const o = curOrder();
  if (!confirm(`Place the order for ${money(o.total)}?`)) return;
  run(() => S.updateH(['orders', o.id], { approvedBy: S.me(), approvedTotal: o.total }));
};
actions.cancelOrder = () => {
  if (!confirm('Cancel this order? The slot is released and the basket is left as it is.')) return;
  run(() => S.updateH(['orders', curOrder().id], { cancelRequested: S.me() }));
};

// ---------- Meals and staples (the household's library) ----------
const libTabs = now => `<div class="seg" role="tablist">${[['meals', 'Meals'], ['staples', 'Staples']].map(([r, l]) => `<a href="#/${r}" role="tab" class="${r === now ? 'on' : ''}" aria-selected="${r === now}">${l}</a>`).join('')}</div>`;
function viewMeals() {
  const meals = [...st.meals].filter(m => !m.archived).sort((a, b) => (b.timesChosen || 0) - (a.timesChosen || 0) || a.name.localeCompare(b.name));
  let html = libTabs('meals') + head('Meals', { sub: 'Your dinners. Each Sunday, ideas for the week are picked from these and from Claude.', right: `<a class="btn small tonal" href="#/meal/new">${icon('plus')} New</a>` });
  html += `<form class="card" data-form="importLink"><h3 style="display:flex;gap:8px;align-items:center">${icon('link')} Add a recipe from a link</h3>
      <p class="small muted" style="margin:4px 0 12px">Paste a recipe page, or share it to Weekly Shop from your phone. The ingredients are added for you.</p>
      <div class="inputrow"><input type="url" name="url" data-keep="importUrl" placeholder="https://www.bbcgoodfood.com/recipes/…" inputmode="url" autocomplete="off" required aria-label="Recipe link"><button class="btn primary">Add recipe</button></div>
      <label class="row small" style="margin-top:12px;gap:10px"><input type="checkbox" name="week" class="check" checked> Pick it for this week</label></form>
    ${importsHtml()}`;
  if (!meals.length) return html + `<div class="card">${empty('bowl', 'No meals yet', 'Load a starter set of family dinners, or add your own.', '<button class="btn primary" data-act="loadStarter">Load starter meals</button>')}</div>`;
  const inWeek = new Set(week()?.offered || []);
  html += section('All meals', { count: meals.length });
  html += `<div class="search" style="margin-bottom:10px">${icon('search')}<input type="search" placeholder="Search meals" data-keep="mealSearch" data-filter="mealList" aria-label="Search meals"></div>`;
  html += `<div class="card flush"><ul class="list" id="mealList">` + meals.map(m => `<li class="link-row" data-name="${esc(m.name.toLowerCase())}">${tile(m, 'sm')}<a href="#/meal/${m.id}" class="grow">
      <span class="name">${esc(m.name)}</span><span class="meta">${plural((m.ingredients || []).length, 'ingredient')}${m.ingredientsBy === 'claude' ? ' (from Claude)' : ''}${m.timesChosen ? ` · picked ${m.timesChosen}×` : ''}${m.lastChosen ? `, last ${fmtDay(m.lastChosen)}` : ''}</span></a>
      ${week() && !inWeek.has(m.id) ? `<button class="btn small outline" data-act="offer" data-id="${m.id}">Add to this week</button>` : inWeek.has(m.id) ? '<span class="pill ok">In this week\'s ideas</span>' : ''}</li>`).join('') + `</ul></div>`;
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
  keep = {};
  run(async () => {
    if (arg === 'new') await S.addH(['meals'], { ...data, timesChosen: 0, createdAt: S.serverTimestamp() });
    else await S.updateH(['meals', arg], data);
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
      <p class="tiny muted" style="margin-top:10px">A new link stops the old one working. People already in stay in.</p></div>

    ${section('Notifications')}
    <div class="card"><div class="row nowrap" style="gap:12px;align-items:flex-start"><span class="tile sm other">${icon('bell')}</span><span class="grow">
      <b>Notifications on this phone</b><p class="small muted" style="margin:2px 0 0">When Sunday's ideas are ready, when Sainsbury's needs the SMS code, and when the basket is ready to approve. Each person turns it on on their own phone.</p></span></div>
      ${iphoneNotInstalled ? `<div class="notice info" style="margin:12px 0 0">${icon('info')}<span class="grow">On iPhone, add Weekly Shop to your home screen first (Share › Add to Home Screen) and turn this on from there.</span></div>` : ''}
      <div style="margin-top:12px">${S.notificationsOn() ? `<div class="row"><span class="chip ok">${icon('check')} On for this phone</span><span class="spacer"></span><button class="btn small outline" data-act="notifyOff">Turn off</button></div>` : `<button class="btn tonal block" data-act="notifyOn">${icon('bell')} Turn on notifications</button>`}</div></div>

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
    <div class="card"><p class="small muted">Add the dates you're away. Sunday ideas pause for any week you're away for most of, and delivery days in that time can't be picked.</p>
      ${(h.away || []).filter(a => a.to >= today()).map(a => `<div class="row nowrap" style="margin-bottom:10px;padding:10px 12px;border-radius:12px;background:var(--surface-2)">${icon('plane')}<span class="grow small"><b>${fmtDay(a.from, { weekday: 'short', day: 'numeric', month: 'short' })} – ${fmtDay(a.to, { weekday: 'short', day: 'numeric', month: 'short' })}</b></span><button class="btn small ghost danger" data-act="delAway" data-id="${esc(a.from)}|${esc(a.to)}">Remove</button></div>`).join('')}
      <form data-form="addAway" class="row nowrap"><input type="date" name="from" required aria-label="From"><input type="date" name="to" required aria-label="To"><button class="btn primary">Add</button></form></div>

    ${section('Data')}
    <div class="card"><b>Import order history</b><p class="small muted" style="margin:2px 0 10px">Load staples and meal history from a seed file made from your Sainsbury's orders.</p>
      <input type="file" accept="application/json" data-change="importFile"></div>

    ${section('Account')}
    <div class="card"><div class="row nowrap"><span class="grow small"><span class="muted">Signed in as</span><br><b>${esc(st.user.email)}</b></span><button class="btn outline" data-act="signOut">${icon('logout')} Sign out</button></div></div>`;
}
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
