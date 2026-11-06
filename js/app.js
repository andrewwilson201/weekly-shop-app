import * as S from './store.js';
import { weekId, iso, addDays, buildShop, stapleStatus, pickIdeas, awayOn, awayWeek, skipRule } from './plan.js';

const $main = document.getElementById('main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n == null || isNaN(n) ? '' : `£${Number(n).toFixed(2)}`);
const fmtDay = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'Europe/London' });
const fmtTime = t => new Date(t).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London' }).replace(':00', '').replace(' ', '');
const today = () => iso(new Date());

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
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

// Inputs being typed into survive live re-renders.
let keep = {};
function remember() {
  document.querySelectorAll('[data-keep]').forEach(el => { keep[el.dataset.keep] = el.value; });
  const a = document.activeElement;
  return a && a.dataset && a.dataset.keep ? { k: a.dataset.keep, s: a.selectionStart } : null;
}
function restore(focus) {
  document.querySelectorAll('[data-keep]').forEach(el => { if (keep[el.dataset.keep] != null) el.value = keep[el.dataset.keep]; });
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
  tabs.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.tab === route || (route === 'order' && a.dataset.tab === 'shop') || (route === 'meal' && a.dataset.tab === 'meals')));
  const focus = remember();
  if (!st.ready) { $main.innerHTML = '<p class="loading">Loading…</p>'; return; }
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
$main.addEventListener('input', e => { const el = e.target; if (el.dataset?.keep) keep[el.dataset.keep] = el.value; });

// ---------- sign in & household ----------
function viewSignIn() {
  return `<div class="signin"><img src="icon.svg" alt="">
    <h1>Weekly Shop</h1><p class="sub">Pick the week's meals together, keep one shopping list, and send it all to Sainsbury's.</p>
    <button class="btn primary" data-act="signIn">Sign in with Google</button>
    ${S.emulator ? `<form data-form="testSignIn" class="card" style="margin-top:24px;text-align:left"><p class="small muted">Emulator test sign-in</p>
      <input type="text" name="name" placeholder="Name"><input type="text" name="email" placeholder="Email" style="margin-top:8px"><button class="btn block" style="margin-top:8px">Test sign in</button></form>` : ''}</div>`;
}
actions.signIn = () => run(S.signIn);
actions.testSignIn = f => run(async () => { await S.testSignIn(f.name.value, f.email.value); location.reload(); });

const inviteFromUrl = () => new URLSearchParams(location.search).get('join');
function viewSetup() {
  const code = inviteFromUrl();
  if (code) {
    return `<h1>Join a household</h1><p class="sub">You've been invited to share a weekly shop.</p>
      <div class="card"><p id="inviteName" class="muted">Checking the invite…</p>
      <button class="btn primary block" data-act="join">Join</button></div>
      <p class="small muted">Signed in as ${esc(st.user.email)}. <a href="#" data-act="signOut">Not you?</a></p>${checkInvite(code)}`;
  }
  return `<h1>Set up your household</h1>
    <p class="sub">Make a household, then send the invite link to whoever you shop with.</p>
    <form class="card" data-form="create">
      <label class="field">Household name<input type="text" name="name" value="${esc((st.user.displayName || '').split(' ').pop() || 'Our')} household" required></label>
      <button class="btn primary block">Create household</button>
    </form>
    <p class="small muted">Got an invite link? Open it on this phone to join instead.<br>Signed in as ${esc(st.user.email)}. <a href="#" data-act="signOut">Sign out</a></p>`;
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

// ---------- This week ----------
function viewWeek() {
  const w = week();
  const order = activeOrder();
  let html = `<h1>This week</h1><p class="sub">Week of ${fmtDay(thisWeekId(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>`;
  if (order) html += `<a class="card ok row" href="#/order" style="text-decoration:none"><b>Order in progress</b><span class="spacer"></span><span class="pill">${esc(stateLabel(order.state))}</span></a>`;
  const lastPlaced = st.orders.find(o => o.state === 'placed' && o.week === thisWeekId());
  if (lastPlaced) html += `<div class="card ok"><b>Ordered</b> for ${fmtDay(lastPlaced.deliveryDate)}${lastPlaced.slot ? `, ${fmtTime(lastPlaced.slot.start_time)}–${fmtTime(lastPlaced.slot.end_time)}` : ''}${lastPlaced.total ? ` · ${money(lastPlaced.total)}` : ''}</div>`;

  const away = st.household.away || [];
  const nowAway = awayOn(away, today()) || (awayWeek(away, thisWeekId()) && away.find(a => a.to >= today()));
  if (nowAway) html += `<div class="card warn"><b>Holiday mode</b>: away ${fmtDay(nowAway.from)} to ${fmtDay(nowAway.to)}. Sunday ideas are paused for weeks you're away. <a href="#/settings">Change</a></div>`;
  if (!st.meals.length) {
    return html + `<div class="card"><p>No meals yet. Load the starter list of family meals to get going (you can edit them and add your own).</p>
      <button class="btn primary" data-act="loadStarter">Load starter meals</button></div>`;
  }
  if (!w?.offered?.length) {
    if (w?.ideasRequested) return html + `<div class="card"><p><b>Claude is choosing this week's ideas.</b> They'll appear here in a minute or two.</p></div>`;
    return html + `<div class="card"><p>This week's ideas haven't been made yet. They're made every Sunday morning, or you can make them now.</p>
      <div class="row"><button class="btn primary" data-act="askClaude">Ask Claude for ideas</button><button class="btn" data-act="makeIdeas">Pick from our meals now</button></div>
      <p class="small muted" style="margin-bottom:0">Claude learns from what you've picked before and suggests some new dishes. Without an API key set up, you get the usual picks instead.</p></div>`;
  }
  const picks = w.picks || {};
  const n = Object.keys(picks).length;
  html += `<h2>Pick 5 meals <span class="muted small">${n} picked</span></h2>`;
  w.offered.forEach((id, i) => {
    const m = mealById(id); if (!m) return;
    const p = picks[id];
    html += `<button class="meal${p ? ' on' : ''}" data-act="pick" data-id="${esc(id)}">
      <span class="num">${i + 1}</span>
      <span class="grow"><span class="title">${esc(m.name)}</span><br>
      ${w.reasons?.[id] ? `<span class="small muted">${esc(w.reasons[id])}</span><br>` : ''}
      ${m.timesChosen ? `<span class="chip fav">Picked ${m.timesChosen}×</span>` : `<span class="chip">${m.addedBy?.name === 'Claude' ? 'New from Claude' : 'New'}</span>`}
      ${p ? `<span class="chip ok">${esc(p.name)}</span>` : ''}</span></button>`;
  });
  html += `<div class="row"><button class="btn small" data-act="addIdea">Add another meal</button><button class="btn small" data-act="remakeIdeas">Swap the unpicked ones</button>
    <button class="btn small" data-act="askClaude" ${w.ideasRequested ? 'disabled' : ''}>${w.ideasRequested ? 'Claude is thinking…' : 'Ask Claude for fresh ideas'}</button></div>`;

  html += `<h2>Delivery day</h2><div class="days">`;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today(), i);
    const off = awayOn(away, d);
    html += `<button data-act="day" data-id="${d}" class="${w.deliveryDate === d ? 'on' : ''}" ${off ? 'disabled title="Away"' : ''}><b>${fmtDay(d, { weekday: 'short' })}</b><span>${off ? 'Away' : fmtDay(d, { day: 'numeric', month: 'short' })}</span></button>`;
  }
  html += `</div>`;
  const listCount = st.list.filter(x => !x.done).length;
  html += `<div class="sticky-foot row"><span class="grow small">${n} meal${n === 1 ? '' : 's'}${w.deliveryDate ? ` · ${fmtDay(w.deliveryDate)}` : ' · no day yet'} · ${listCount} on the list</span>
    <a class="btn primary" href="#/shop">Build the shop</a></div>`;
  return html;
}
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
  let html = `<h1>Shopping list</h1><p class="sub">Anything you need that isn't a staple or in a meal. It goes in this week's shop.</p>
    <form data-form="addItem" class="row" style="flex-wrap:nowrap"><input type="text" name="text" data-keep="newItem" placeholder="Add an item, e.g. olive oil" autocomplete="off" enterkeyhint="done"><button class="btn primary">Add</button></form>`;
  if (!items.length) return html + `<p class="empty">The list is empty.</p>`;
  html += `<ul class="list card" style="margin-top:12px">`;
  for (const it of items) {
    html += `<li><input type="checkbox" class="check" data-change="toggleItem" data-id="${it.id}" ${it.done ? 'checked' : ''} aria-label="Got it">
      <span class="grow"><span class="name ${it.done ? 'strike' : ''}">${esc(it.text)}</span>${it.qty > 1 ? ` <span class="pill">×${it.qty}</span>` : ''}
      <br><span class="meta">${esc(it.addedBy?.name || '')}${it.orderedIn ? ' · in an order' : ''}</span></span>
      <button class="iconbtn" data-act="delItem" data-id="${it.id}" aria-label="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></li>`;
  }
  html += `</ul>`;
  if (items.some(i => i.done)) html += `<button class="btn small" data-act="clearDone">Clear ticked items</button>`;
  return html;
}
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
  return buildShop({ staples: st.staples, meals: pickedMeals(), list: st.list, delivery: w.deliveryDate || addDays(today(), 2), extras: w.extras || {} });
}
function viewShop() {
  const w = week();
  const order = activeOrder();
  let html = `<h1>The shop</h1>`;
  if (order) return html + `<div class="card ok"><p><b>An order is in progress.</b></p><a class="btn primary" href="#/order">See the order</a></div>`;
  if (!w?.deliveryDate) html += `<div class="card warn">Pick a delivery day on <a href="#/week">This week</a> first. Staples below are worked out for ${fmtDay(addDays(today(), 2))}.</div>`;
  else html += `<p class="sub">For delivery on ${fmtDay(w.deliveryDate, { weekday: 'long', day: 'numeric', month: 'long' })}. Untick anything you don't need.</p>`;
  const lines = shopLines();
  const extras = w?.extras || {};
  const groups = [['staple', 'Staples due'], ['meal', 'For the meals'], ['list', 'From the list']];
  for (const [src, title] of groups) {
    const ls = lines.filter(l => l.source === src);
    if (src === 'staple') {
      const skipped = Object.entries(extras).filter(([k, v]) => k.startsWith('staple:') && v === false).length;
      html += `<div class="row" style="margin:26px 0 10px"><h2 style="margin:0">${title} <span class="muted small">${ls.length}</span></h2><span class="spacer"></span>
        ${ls.length ? '<button class="btn small" data-act="skipStaples">Skip all staples</button>' : ''}${skipped ? `<button class="btn small" data-act="unskipStaples">Put back ${skipped}</button>` : ''}</div>`;
      if (!ls.length) { html += `<p class="muted small">${st.staples.length ? 'None this week.' : 'No staples yet. Import them in Settings.'}</p>`; continue; }
      html += `<details class="card" ${keep.staplesOpen === false ? '' : 'open'} data-toggle="staplesOpen" style="padding-top:8px;padding-bottom:8px"><summary class="small">${ls.length} things you buy regularly. Untick any you don't need.</summary><ul class="list">` + ls.map(l => `<li><input type="checkbox" class="check" checked data-change="lineOff" data-id="${esc(l.key)}" aria-label="Include">
        <span class="grow"><span class="name">${esc(l.name)}</span>${l.qty > 1 ? ` <span class="pill">×${l.qty}</span>` : ''}</span></li>`).join('') + `</ul></details>`;
      continue;
    }
    html += `<h2>${title} <span class="muted small">${ls.length}</span></h2>`;
    if (!ls.length) { html += `<p class="muted small">${src === 'meal' ? 'No meals picked yet.' : 'Nothing on the list.'}</p>`; continue; }
    html += `<ul class="list card">` + ls.map(l => `<li><input type="checkbox" class="check" checked data-change="lineOff" data-id="${esc(l.key)}" aria-label="Include">
      <span class="grow"><span class="name">${esc(l.name)}</span>${l.qty > 1 ? ` <span class="pill">×${l.qty}</span>` : ''}
      ${l.for ? `<br><span class="meta">${esc(l.for.join(', '))}</span>` : ''}</span></li>`).join('') + `</ul>`;
  }
  // Staples not added: suggestions and ones switched off
  const off = st.staples.filter(s => !lines.some(l => l.key === `staple:${s.id}`)).map(s => ({ s, status: stapleStatus(s, w?.deliveryDate || addDays(today(), 2)) }))
    .filter(x => x.status === 'suggest' || extras[`staple:${x.s.id}`] === false);
  const offMeal = pickedMeals().flatMap(m => (m.ingredients || []).filter(i => !lines.some(l => l.key === `meal:${m.id}:${i.item}`)).map(i => ({ key: `meal:${m.id}:${i.item}`, name: i.item, for: i.pantry && extras[`meal:${m.id}:${i.item}`] !== false ? `${m.name} · probably in the cupboard` : m.name })));
  if (off.length || offMeal.length) {
    html += `<details class="card soft"><summary>Suggestions and things you unticked (${off.length + offMeal.length})</summary><ul class="list">` +
      off.map(({ s, status }) => `<li><input type="checkbox" class="check" data-change="lineOn" data-id="staple:${esc(s.id)}"><span class="grow">${esc(s.name)}<br><span class="meta">${status === 'suggest' ? 'Sometimes needed for meals' : 'Unticked'}</span></span></li>`).join('') +
      offMeal.map(x => `<li><input type="checkbox" class="check" data-change="lineOn" data-id="${esc(x.key)}"><span class="grow">${esc(x.name)}<br><span class="meta">${esc(x.for)}</span></span></li>`).join('') +
      `</ul></details>`;
  }
  html += `<div class="sticky-foot row"><span class="grow small">${lines.length} lines · no substitutions</span>
    <button class="btn primary" data-act="order" ${w?.deliveryDate && lines.length ? '' : 'disabled'}>Order from Sainsbury's</button></div>`;
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
function viewOrder() {
  const o = arg ? st.orders.find(x => x.id === arg) : (activeOrder() || st.orders[0]);
  if (!o) return `<h1>Order</h1><p class="empty">No orders yet. Build the shop first.</p><a class="btn" href="#/shop">Go to the shop</a>`;
  const idx = STEPS.findIndex(s => s[0] === o.state);
  let html = `<h1>Order for ${fmtDay(o.deliveryDate, { weekday: 'long', day: 'numeric', month: 'short' })}</h1>
    <p class="sub">Started by ${esc(o.requestedBy?.name)}${o.slot ? ` · ${fmtTime(o.slot.start_time)}–${fmtTime(o.slot.end_time)}` : ''}</p>`;
  html += `<ul class="steps card">` + STEPS.map(([k, label], i) => `<li class="${i < idx || o.state === 'placed' ? 'done' : i === idx ? 'now' : ''}"><span class="dot"></span>${label}</li>`).join('') + `</ul>`;
  if (o.message) html += `<div class="card ${o.state === 'failed' || o.state === 'needs_you' ? 'danger' : 'soft'}">${esc(o.message)}</div>`;

  if (o.state === 'requested') html += `<p class="muted small">The order helper checks for new orders every few minutes, so this can take up to 10 minutes to start. You can close the app; it carries on.</p>`;
  if (o.state === 'need_code') {
    html += `<form class="card" data-form="code"><p>Sainsbury's has texted a 6-digit code to the account's phone. Type it here.</p>
      <input class="code" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" data-keep="sms" required>
      <button class="btn primary block" style="margin-top:10px" ${o.smsCode ? 'disabled' : ''}>${o.smsCode ? 'Sent, checking…' : 'Send code'}</button></form>`;
  }
  if (o.state === 'choose_slot') {
    const slots = (o.slots || []);
    const days = [...new Set(slots.map(s => s.date))];
    html += `<div class="card"><p>Pick a delivery time. ${o.slotChoice ? 'Booking it…' : ''}</p>`;
    if (!slots.length) html += `<p class="muted">No free slots around that day.</p>`;
    for (const d of days) {
      html += `<h2 style="margin-top:12px">${fmtDay(d, { weekday: 'long', day: 'numeric', month: 'short' })}</h2><div class="slots">` +
        slots.filter(s => s.date === d).map(s => `<button data-act="slot" data-id="${esc(s.start_time)}" class="${o.slotChoice === s.start_time ? 'on' : ''}" ${o.slotChoice ? 'disabled' : ''}>${fmtTime(s.start_time)}–${fmtTime(s.end_time)}<small>${s.price ? money(s.price) : 'Free'}${s.is_green ? ' · green' : ''}</small></button>`).join('') + `</div>`;
    }
    html += `</div>`;
  }
  if (['review', 'placing', 'placed'].includes(o.state) || (o.basket && o.state === 'failed')) {
    const b = o.basket || {};
    const missing = (o.lines || []).filter(l => l.result && l.result !== 'added');
    if (missing.length) html += `<div class="card warn"><b>${missing.length} not added</b><ul class="list">${missing.map(l => `<li><span class="grow">${esc(l.name)}<br><span class="meta">${esc(l.result === 'not_found' ? 'Not found' : l.result === 'unavailable' ? 'Unavailable' : l.result)}</span></span></li>`).join('')}</ul></div>`;
    html += `<div class="card"><h2 style="margin-top:0">Basket</h2><ul class="list">` + (b.items || []).map(i => `<li><span class="grow"><span class="name">${esc(i.name)}</span>${i.qty > 1 ? ` <span class="pill">×${i.qty}</span>` : ''}${i.offer ? `<br><span class="meta">${esc(i.offer)}</span>` : ''}</span><span class="price">${money(i.total)}</span></li>`).join('') + `</ul>
      <div class="row small muted"><span>Items</span><span class="spacer"></span><span class="price">${money(b.subtotal)}</span></div>
      ${b.savings ? `<div class="row small muted"><span>Savings</span><span class="spacer"></span><span class="price">−${money(b.savings)}</span></div>` : ''}
      <div class="row small muted"><span>Delivery</span><span class="spacer"></span><span class="price">${money(b.delivery)}</span></div>
      <div class="total"><span>Total</span><span class="price">${money(o.total)}</span></div>
      ${o.card ? `<p class="small muted">Paid with ${esc(o.card)} on delivery day. Substitutions off.</p>` : ''}</div>`;
    if (o.state === 'review') {
      html += `<div class="sticky-foot"><p class="small" style="margin:0 0 8px">Approving places the order with Sainsbury's. You can still change it in the Sainsbury's app until the cut-off.</p>
        <div class="row"><button class="btn danger" data-act="cancelOrder">Cancel</button><span class="spacer"></span>
        <button class="btn primary" data-act="approve" ${o.approvedBy ? 'disabled' : ''}>${o.approvedBy ? 'Placing…' : `Approve ${money(o.total)}`}</button></div></div>`;
    }
  }
  if (o.state === 'placed') html += `<div class="card ok"><b>Order placed.</b> ${o.orderNumber ? `Sainsbury's order ${esc(o.orderNumber)}.` : ''} Staples, meals and the list have been updated.</div>`;
  if (!['placed', 'failed', 'cancelled', 'review'].includes(o.state)) html += `<div class="row end"><button class="btn small danger" data-act="cancelOrder">Cancel</button></div>`;
  if (['failed', 'cancelled'].includes(o.state)) html += `<a class="btn" href="#/shop">Back to the shop</a>`;
  if (o.log?.length) html += `<details class="card soft" style="margin-top:12px"><summary>Details</summary><ul class="list small">${o.log.slice(-20).map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>`;
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

// ---------- Meals ----------
function viewMeals() {
  const meals = [...st.meals].filter(m => !m.archived).sort((a, b) => (b.timesChosen || 0) - (a.timesChosen || 0) || a.name.localeCompare(b.name));
  let html = `<h1>Meals</h1><p class="sub">Your meal library. The most picked come up as favourites each week.</p>
    <form class="card" data-form="importLink"><label class="field" style="margin:0 0 8px">Add a recipe from a link
      <input type="url" name="url" data-keep="importUrl" placeholder="https://www.bbcgoodfood.com/recipes/…" inputmode="url" autocomplete="off" required></label>
      <label class="row small"><input type="checkbox" name="week" class="check" checked> Pick it for this week</label>
      <button class="btn primary block" style="margin-top:10px">Add recipe</button>
      <p class="small muted" style="margin:8px 0 0">Or share a recipe page to Weekly Shop from your phone's share menu. It takes a moment to read.</p></form>
    ${importsHtml()}
    <div class="row"><a class="btn" href="#/meal/new">Type in a meal</a>${st.meals.length ? '' : '<button class="btn" data-act="loadStarter">Load starter meals</button>'}</div>`;
  const inWeek = new Set(week()?.offered || []);
  html += `<ul class="list card" style="margin-top:12px">` + meals.map(m => `<li><a href="#/meal/${m.id}" class="grow" style="text-decoration:none">
      <span class="name">${esc(m.name)}</span><br><span class="meta">${(m.ingredients || []).length} ingredients${m.ingredientsBy === 'claude' ? ' (from Claude)' : ''}${m.timesChosen ? ` · picked ${m.timesChosen}×` : ''}${m.lastChosen ? `, last ${fmtDay(m.lastChosen)}` : ''}</span></a>
      ${week() && !inWeek.has(m.id) ? `<button class="btn small" data-act="offer" data-id="${m.id}">Add to this week</button>` : inWeek.has(m.id) ? '<span class="pill">In this week\'s ideas</span>' : ''}</li>`).join('') + `</ul>`;
  const archived = st.meals.filter(m => m.archived);
  if (archived.length) html += `<details class="card soft"><summary>Removed meals (${archived.length})</summary><ul class="list">${archived.map(m => `<li><span class="grow">${esc(m.name)}</span><button class="btn small" data-act="unarchive" data-id="${m.id}">Restore</button></li>`).join('')}</ul></details>`;
  return html;
}
function importsHtml() {
  const recent = st.imports.filter(i => i.state !== 'done' || (i.doneAt && Date.now() - i.doneAt.toMillis() < 864e5)).slice(0, 5);
  if (!recent.length) return '';
  return `<ul class="list card">` + recent.map(i => `<li><span class="grow"><span class="name">${esc(i.name || i.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</span><br>
    <span class="meta">${i.state === 'requested' || i.state === 'reading' ? 'Reading the recipe…' : i.state === 'failed' ? esc(i.message || 'Couldn\'t read it') : `${i.count} ingredients added${i.addToWeek ? ', picked for this week' : ''}`}</span></span>
    ${i.state === 'done' && i.mealId ? `<a class="btn small" href="#/meal/${i.mealId}">Check it</a>` : ''}
    ${i.state !== 'requested' ? `<button class="iconbtn" data-act="dismissImport" data-id="${i.id}" aria-label="Dismiss"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : ''}</li>`).join('') + `</ul>`;
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
  if (!m) return `<p class="empty">Meal not found.</p>`;
  const lines = (m.ingredients || []).map(i => `${i.item}${i.qty > 1 ? ` x${i.qty}` : ''}${i.pantry ? ' (cupboard)' : ''}${i.search && ![i.item.toLowerCase(), `sainsburys ${i.item.toLowerCase()}`].includes(i.search.toLowerCase()) ? ` | ${i.search}` : ''}`).join('\n');
  return `<h1>${arg === 'new' ? 'Add a meal' : 'Edit meal'}</h1>
    <form class="card" data-form="saveMeal">
      <label class="field">Name<input type="text" name="name" value="${esc(m.name)}" required data-keep="mealName"></label>
      ${m.source ? `<p class="small muted">From <a href="${esc(m.source)}" target="_blank" rel="noopener">${esc(m.source.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a></p>` : ''}
      <label class="field">Ingredients, one per line. Add “x2” for two, “(cupboard)” for things you usually have, and “| search words” to pick the exact Sainsbury's product.
        <textarea name="ingredients" rows="8" placeholder="Chicken thighs x2&#10;Lemons | sainsburys unwaxed lemons" data-keep="mealIng">${esc(lines)}</textarea></label>
      <div class="row"><button class="btn primary">Save</button><a class="btn" href="#/meals">Back</a><span class="spacer"></span>
      ${arg === 'new' ? '' : '<button type="button" class="btn danger" data-act="archiveMeal">Remove</button>'}</div>
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
  const label = { add: 'Due', not_due: 'Not due', suggest: 'For meals', lapsed: 'Not bought lately', dropped: 'Off' };
  const rows = st.staples.map(s => ({ s, status: stapleStatus(s, d) })).sort((a, b) => ['add', 'suggest', 'not_due', 'lapsed', 'dropped'].indexOf(a.status) - ['add', 'suggest', 'not_due', 'lapsed', 'dropped'].indexOf(b.status) || a.s.name.localeCompare(b.s.name));
  let html = `<h1>Staples</h1><p class="sub">Things you buy regularly, worked out from your past orders. “Due” ones go in the shop for ${fmtDay(d)}.</p>`;
  if (!rows.length) return html + `<p class="empty">No staples yet. Import them in <a href="#/settings">Settings</a>.</p>`;
  html += `<ul class="list card">` + rows.map(({ s, status }) => `<li><span class="grow"><span class="name">${esc(s.name)}</span><br>
      <span class="meta">${skipRule(s) === 'every_week' ? 'Every week' : s.every_days ? `About every ${s.every_days} days` : ''}${s.last_bought ? ` · last ${fmtDay(s.last_bought)}` : ''} · ×${s.quantity || 1}${s.skips ? ` · left out ${s.skips}× running` : ''}</span>
      ${s.learned && s.skips >= 3 ? `<br><span class="meta">${esc(s.learned)} <a href="#" data-act="resetSkips" data-id="${s.id}">Undo</a></span>` : ''}
      ${s.freqNote ? `<br><span class="meta">${esc(s.freqNote)}</span>` : ''}
      ${s.times_bought ? `<details data-toggle="hist-${s.id}"><summary class="meta">Bought ${s.times_bought}×${(s.history || []).length ? ', see when' : ''}</summary>${(s.history || []).length ? `<span class="meta">${[...s.history].reverse().map(x => `${fmtDay(x.date)}${x.qty > 1 ? ` ×${x.qty}` : ''}`).join(' · ')}</span>` : '<span class="meta">Dates are logged from your first order in the app.</span>'}</details>` : ''}</span>
      <span class="pill">${label[status]}</span>
      <button class="btn small" data-act="dropStaple" data-id="${s.id}">${s.dropped ? 'Turn on' : 'Turn off'}</button></li>`).join('') + `</ul>`;
  return html;
}
actions.resetSkips = el => run(() => S.updateH(['staples', el.dataset.id], { skips: 0, learned: S.deleteField(), skipped_on: S.deleteField() }));
actions.dropStaple = el => run(() => { const s = st.staples.find(x => x.id === el.dataset.id); return S.updateH(['staples', s.id], { dropped: !s.dropped }); });

// ---------- Settings ----------
function viewSettings() {
  const h = st.household;
  const link = `${location.origin}${location.pathname}?join=${h.inviteCode}`;
  return `<h1>Settings</h1>
    <div class="card"><h2 style="margin-top:0">${esc(h.name)}</h2>
      <p class="muted small">Members: ${Object.values(h.memberNames || {}).map(esc).join(', ')}</p>
      <p>Invite someone to share this shop by sending them this link:</p>
      <input type="text" readonly value="${esc(link)}" onclick="this.select()">
      <div class="row" style="margin-top:10px"><button class="btn primary" data-act="share" data-id="${esc(link)}">Share invite link</button>
      <button class="btn small" data-act="newInvite">Make a new link</button></div>
      <p class="small muted">A new link stops the old one working. People already in stay in.</p></div>
    <div class="card"><h2 style="margin-top:0">Notifications</h2>
      <p class="small muted">Get a notification on this phone when Sunday's ideas are ready, when Sainsbury's needs the SMS code, and when the basket is ready to approve. Each person turns it on on their own phone.${/iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone ? ' On iPhone, add Weekly Shop to your home screen first (Share › Add to Home Screen) and turn this on from there.' : ''}</p>
      ${S.notificationsOn() ? `<div class="row"><span class="chip ok">On for this phone</span><button class="btn small" data-act="notifyOff">Turn off</button></div>` : `<button class="btn primary" data-act="notifyOn">Turn on notifications</button>`}</div>
    <form class="card" data-form="saveNotes"><h2 style="margin-top:0">About your household</h2>
      <p class="small muted">Claude reads this when it picks the week's ideas: who's eating, dislikes, allergies, how adventurous to be.</p>
      <textarea name="notes" rows="4" data-keep="notes" placeholder="2 adults, children aged 5 and 7. Mild spice for the kids. No mushrooms.">${esc(h.notes || '')}</textarea>
      <button class="btn small" style="margin-top:8px">Save</button></form>
    <div class="card"><h2 style="margin-top:0">Holiday mode</h2>
      <p class="small muted">Add the dates you're away. Sunday meal ideas pause for any week you're away for most of, and delivery days in that time can't be picked.</p>
      ${(h.away || []).filter(a => a.to >= today()).map((a, i) => `<div class="row" style="margin-bottom:8px"><span class="grow">${fmtDay(a.from, { weekday: 'short', day: 'numeric', month: 'short' })} – ${fmtDay(a.to, { weekday: 'short', day: 'numeric', month: 'short' })}</span><button class="btn small danger" data-act="delAway" data-id="${esc(a.from)}|${esc(a.to)}">Remove</button></div>`).join('')}
      <form data-form="addAway" class="row" style="flex-wrap:nowrap"><input type="date" name="from" required aria-label="From"><input type="date" name="to" required aria-label="To"><button class="btn primary">Add</button></form></div>
    <div class="card"><h2 style="margin-top:0">Import</h2>
      <p class="small muted">Load staples and meal history from a seed file (made by tools/make-seed.py from your Sainsbury's orders).</p>
      <input type="file" accept="application/json" data-change="importFile"></div>
    <div class="card"><p class="small muted">Signed in as ${esc(st.user.email)}</p><button class="btn" data-act="signOut">Sign out</button></div>`;
}
actions.notifyOn = () => run(async () => { await S.enableNotifications(); render(); }, 'Notifications are on for this phone');
actions.notifyOff = () => run(async () => { await S.disableNotifications(); render(); }, 'Notifications are off for this phone');
actions.saveNotes = f => { const notes = f.notes.value.trim().slice(0, 1000); delete keep.notes; run(() => S.updateH([], { notes }), 'Saved'); };
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
