// Settings: the household, notifications, the order helper, and data.
import * as S from '../store.js?v=9';
import { iso } from '../plan.js?v=9';
import { icon, avatar } from '../ui.js?v=9';
import { st, esc, fmtDay, today, head, section, run, render, toast, hostOf, keep, routes, actions } from '../core.js?v=9';
import { activeOrder, householdServes, startOrder } from '../state.js?v=9';

routes.settings = () => {
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
      <b>Notifications on this phone</b><p class="small muted" style="margin:2px 0 0">When Sainsbury's needs the SMS code, when the basket is ready to approve, and the evening before a delivery if anything's waiting on the list. Each person turns it on on their own phone.</p></span></div>
      ${iphoneNotInstalled ? `<div class="notice info" style="margin:12px 0 0">${icon('info')}<span class="grow">On iPhone, add Weekly Shop to your home screen first (Share › Add to Home Screen) and turn this on from there.</span></div>` : ''}
      <div style="margin-top:12px">${S.notificationsOn() ? `<div class="row"><span class="chip ok">${icon('check')} On for this phone</span><span class="spacer"></span><button class="btn small outline" data-act="notifyOff">Turn off</button></div>` : `<button class="btn tonal block" data-act="notifyOn">${icon('bell')} Turn on notifications</button>`}</div></div>

    ${section('Order helper')}
    <div class="card">${helperStatus(h)}
      <div class="row nowrap" style="gap:12px;padding:14px 0;border-bottom:1px solid var(--line)"><span class="grow"><b>SMS code goes to</b><br><span class="small muted">Whose phone gets Sainsbury's login code. They're the one told when it's needed.</span></span>
        <select data-change="codeTo" aria-label="Who gets the SMS code" style="width:auto;flex:none"><option value="">Not set</option>${Object.entries(h.memberNames || {}).map(([uid, name]) => `<option value="${esc(uid)}"${h.codeTo === uid ? ' selected' : ''}>${esc(name.split(' ')[0])}</option>`).join('')}</select></div>
      <div style="padding-top:14px"><b>Trial run</b><p class="small muted" style="margin:2px 0 12px">Checks the whole Sainsbury's order works without buying anything: it logs in (you'll need the SMS code), books a slot, fills the basket with the next shop, goes to checkout and reads the total, then stops before Place order. Afterwards it takes out what it added and releases the slot.</p>
      ${activeOrder() ? `<a class="btn outline block" href="#/order">An order is running: view it</a>` : `<button class="btn tonal block" data-act="trialOrder">${icon('cart')} Start a trial run</button>`}</div>
      <a class="btn ghost block" href="#/history" style="margin-top:8px">${icon('list')} Order history</a></div>

    ${section('Prices')}
    <div class="card"><div class="row nowrap" style="gap:12px;align-items:flex-start"><span class="grow"><b>Cheaper swaps</b><p class="small muted" style="margin:2px 0 0">When the basket is filled, swap to a product that's on offer if it's the cheapest of products that are the same thing (same quality, organic or free range kept, brand kept where it matters), going by price per kg, litre or item with offers, Nectar prices and multibuys counted. The swaps are listed before you approve. Your notes below are followed, for example “always Heinz beans”.</p></span>
      <input type="checkbox" class="switch" data-change="cheaperSwaps" ${h.cheaperSwaps === false ? '' : 'checked'} aria-label="Cheaper swaps"></div></div>

    ${section('Claude')}
    <form class="card" data-form="saveNotes"><label class="field" style="margin-bottom:10px">About your household<span class="hint">Claude reads this when it picks the week's ideas and checks for cheaper swaps: who's eating, dislikes, allergies, how adventurous to be, brands you always buy.</span>
      <textarea name="notes" rows="4" data-keep="notes" placeholder="2 adults, children aged 5 and 7. Mild spice for the kids. No mushrooms.">${esc(h.notes || '')}</textarea></label>
      <button class="btn small primary">Save</button></form>

    ${section('Recipe sites')}
    <div class="card"><p class="small muted">Each time you ask for ideas, one is a recipe published in the last week on each of these sites. Add a recipe site's address (or its RSS feed).</p>
      ${sources().map((s, i) => { const st2 = (h.recipeSourceStatus || []).find(x => x.url === s.url); return `<div class="row nowrap" style="margin-bottom:10px;padding:10px 12px;border-radius:12px;background:var(--surface-2)">${icon('link')}<span class="grow small"><b>${esc(s.name || hostOf(s.url))}</b><br><span class="muted">${esc(hostOf(s.url))}${st2 ? ` · ${st2.ok ? '' : 'Last try failed: '}${esc(st2.note)}` : ''}</span></span><button class="btn small ghost danger" data-act="delSource" data-id="${i}">Remove</button></div>`; }).join('')}
      ${sources().length < 5 ? `<form data-form="addSource" class="row"><input type="text" name="url" required style="flex:2 1 160px" placeholder="bbcgoodfood.com" aria-label="Recipe site address" inputmode="url" autocapitalize="off"><input type="text" name="name" placeholder="Name (optional)" aria-label="Name" style="flex:1 1 120px"><button class="btn primary">Add</button></form>` : ''}</div>

    ${section('Holiday mode')}
    <div class="card"><p class="small muted">Add the dates you're away. Delivery days in that time can't be picked.</p>
      ${(h.away || []).filter(a => a.to >= today()).map(a => `<div class="row nowrap" style="margin-bottom:10px;padding:10px 12px;border-radius:12px;background:var(--surface-2)">${icon('plane')}<span class="grow small"><b>${fmtDay(a.from, { weekday: 'short', day: 'numeric', month: 'short' })} – ${fmtDay(a.to, { weekday: 'short', day: 'numeric', month: 'short' })}</b></span><button class="btn small ghost danger" data-act="delAway" data-id="${esc(a.from)}|${esc(a.to)}">Remove</button></div>`).join('')}
      <form data-form="addAway" class="row away-form"><label class="field">From<input type="date" name="from" required></label><label class="field">To<input type="date" name="to" required></label><button class="btn primary">Add</button></form></div>

    ${section('Data')}
    <div class="card"><b>Download your data</b><p class="small muted" style="margin:2px 0 10px">Everything the household has saved (meals, staples, the list, plans and orders) as one file, to keep a copy.</p>
      <button class="btn outline" data-act="exportData">${icon('download')} Download</button>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><b>Import order history</b><p class="small muted" style="margin:2px 0 10px">Load staples and meal history from a seed file made from your Sainsbury's orders.</p>
      <input type="file" accept="application/json" data-change="importFile"></div></div>

    ${section('Account')}
    <div class="card"><div class="row nowrap"><span class="grow small"><span class="muted">Signed in as</span><br><b>${esc(st.user.email)}</b></span><button class="btn outline" data-act="signOut">${icon('logout')} Sign out</button></div></div>`;
};
// The GitHub key the order helper runs on, checked weekly (functions/tasks.mjs checkWorker).
function helperStatus(h) {
  const s = h.orderHelper;
  if (!s) return '';
  const checked = s.checkedAt?.toDate ? fmtDay(iso(s.checkedAt.toDate())) : '';
  const days = s.expires ? Math.round((new Date(s.expires) - Date.now()) / 864e5) : null;
  const fix = 'Make a new fine-grained token on GitHub (this repository, Actions: read and write), then run <code>firebase functions:secrets:set WORKER_GITHUB_TOKEN</code> and deploy the functions again. See the README.';
  if (!s.ok) return `<div class="notice danger" style="margin:0 0 14px">${icon('alert')}<span class="grow"><b>The order helper can't start</b><br>${esc(s.error || 'GitHub turned down its key.')} ${fix}</span></div>`;
  if (days != null && days <= 14) return `<div class="notice warn" style="margin:0 0 14px">${icon('clock')}<span class="grow"><b>Its GitHub key runs out ${days <= 0 ? 'today' : `in ${days === 1 ? 'a day' : `${days} days`}`}</b><br>${fix}</span></div>`;
  return `<p class="small muted" style="margin:0 0 4px">${icon('check')} Working${days != null ? `. Its GitHub key lasts another ${days} days` : ''}${checked ? ` (checked ${checked})` : ''}.</p>`;
}
actions.serves = el => run(() => S.updateH([], { serves: Math.max(1, Math.min(20, householdServes() + Number(el.dataset.id))) }));
actions.codeTo = el => run(() => S.updateH([], { codeTo: el.value || S.deleteField() }), 'Saved');
actions.exportData = () => run(async () => {
  const data = await S.exportAll();
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `weekly-shop-${today()}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10e3);
}, 'Downloaded');
actions.trialOrder = () => { if (confirm('Start a trial run? You\'ll need the SMS code from Sainsbury\'s. Nothing is bought.')) startOrder(true); };
actions.notifyOn = () => run(async () => { await S.enableNotifications(); render(); }, 'Notifications are on for this phone');
actions.notifyOff = () => run(async () => { await S.disableNotifications(); render(); }, 'Notifications are off for this phone');
actions.cheaperSwaps = el => run(() => S.updateH([], { cheaperSwaps: el.checked }), el.checked ? 'Cheaper swaps on' : 'Cheaper swaps off');
actions.saveNotes = f => { const notes = f.notes.value.trim().slice(0, 1000); delete keep.notes; run(() => S.updateH([], { notes }), 'Saved'); };
// Recipe sites (see worker/feeds.mjs). Never set means the Guardian's recipes.
const GUARDIAN = { name: 'The Guardian', url: 'https://www.theguardian.com/tone/recipes/rss' };
const sources = () => Array.isArray(st.household.recipeSources) ? st.household.recipeSources : [GUARDIAN];
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
