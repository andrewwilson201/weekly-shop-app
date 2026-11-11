// Order: one run of the order helper (worker/run.mjs), from the SMS code to
// the placed order. Also "Add to this order" for a placed one.
import * as S from '../store.js?v=9';
import { icon } from '../ui.js?v=9';
import { st, esc, money, fmtDay, fmtTime, today, plural, head, section, empty, run, render, toast, toMillis, keep, route, arg, routes, actions } from '../core.js?v=9';
import { DONE_STATES, STEPS, activeOrder, isStale, flow, planId, startOrder, startAmend, slotText, findOrder } from '../state.js?v=9';

const CODE_MINUTES = 10; // worker/run.mjs: how long Sainsbury's code is waited for
const HERO = {
  requested: ['clock', '', 'Starting the order helper', 'Usually within a few minutes. You can close the app; it carries on.'],
  logging_in: ['lock', '', 'Logging in to Sainsbury\'s', 'This takes about a minute.'],
  need_code: ['message', 'warn', 'Enter the SMS code', ''],
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
const curOrder = () => arg ? findOrder(arg) : (activeOrder() || st.orders[0]);
const firstName = uid => (st.household.memberNames?.[uid] || '').split(' ')[0];
const changeText = c => (c > 0 ? `Up ${money(c)} each since last time` : `Down ${money(-c)} each since last time`);

function hero(o) {
  if (isStale(o)) return ['alert', 'danger', 'The order helper didn\'t start', `Nothing has happened on Sainsbury's. It isn't started this late, so send it again.`];
  if (o.trial && o.state === 'review') return ['bag', 'warn', 'Check the basket', 'Then tap Check out to try Sainsbury\'s checkout. Nothing is paid.'];
  if (o.amend && o.state === 'review') return ['bag', 'warn', 'Check the changed order', 'Nothing changes until you approve.'];
  if (o.amend && o.state === 'placed') return ['check', '', 'Order updated', 'What you added is in the order, and off the list.'];
  if (o.state === 'need_code') {
    const who = firstName(st.household.codeTo);
    return ['message', 'warn', 'Enter the SMS code', `Sainsbury's has texted a 6-digit code to ${who ? `${esc(who)}'s phone` : 'the phone on the Sainsbury\'s account'}.`];
  }
  return HERO[o.state] || HERO.requested;
}
// Minutes left to enter the code, from when the worker asked for it.
function codeLeft(o) {
  const at = toMillis(o.codeAt);
  if (!at) return '';
  const left = Math.ceil((at + CODE_MINUTES * 60e3 - Date.now()) / 60e3);
  return left > 1 ? `${left} minutes left to enter it` : left === 1 ? 'About a minute left' : 'Time\'s nearly up: enter it now';
}

routes.order = () => {
  const o = curOrder();
  if (!o) return head('Order') + empty('cart', 'No orders yet', 'Build the basket and tap Send to start one.', '<a class="btn primary" href="#/shop">Go to the basket</a>');
  // A stopped order shows how far it got (stoppedAt: the step it was on).
  const idx = STEPS.findIndex(s => s[0] === (['failed', 'needs_you'].includes(o.state) && o.stoppedAt ? o.stoppedAt : o.state));
  const [hic, htone, htitle, hsub] = hero(o);
  const kind = o.trial ? 'Trial order' : o.amend ? 'Adding to the order' : 'Order';
  const eyebrow = o.trial ? 'Trial run · nothing is paid' : o.amend ? `Sainsbury's order${o.amend.orderNumber ? ` ${esc(o.amend.orderNumber)}` : ''}` : 'Sainsbury\'s order';
  let html = head(`${kind} for ${fmtDay(o.deliveryDate, { weekday: 'long', day: 'numeric', month: 'short' })}`, { eyebrow, sub: `Started by ${esc(o.requestedBy?.name)}${o.slot ? ` · delivery ${slotText(o)}` : ''}` });
  if (o.week === planId() && !o.trial && !o.amend) html += flow('order');
  if (o.trial && !DONE_STATES.includes(o.state)) html += `<div class="notice info">${icon('info')}<span class="grow"><b>Trial run.</b> It does everything a real order does up to Sainsbury's Place order button, then stops. Afterwards it takes out what it added and releases the slot.</span></div>`;
  const placedSub = o.state === 'placed' && !o.amend ? `${o.orderNumber ? `Sainsbury's order ${esc(o.orderNumber)}. ` : ''}Staples, meals and the list have been updated.` : hsub;
  html += `<div class="hero"><div class="status"><span class="dot-lg ${htone}">${icon(hic)}</span><span class="grow"><h3>${htitle}</h3>${placedSub ? `<p class="sub">${placedSub}</p>` : ''}</span></div></div>`;
  if (o.message) html += `<div class="notice ${['failed', 'needs_you'].includes(o.state) || (o.state === 'cancelled' && o.notStarted) ? 'danger' : ''}">${icon('info')}<span class="grow">${esc(o.message)}</span></div>`;
  // Not picked up (GitHub didn't start the helper): one tap sends it again.
  if ((o.state === 'requested' && (isStale(o) || o.message)) || (o.state === 'cancelled' && o.notStarted && !activeOrder())) {
    html += `<button class="btn primary lg block" data-act="retryOrder" style="margin-bottom:12px">${icon('repeat')} ${o.state === 'requested' ? 'Cancel and try again' : 'Try again'}</button>`;
  }

  if (o.state === 'need_code') {
    const left = codeLeft(o);
    html += `<form class="card" data-form="code"><label class="field" style="margin:0">6-digit code${left ? `<span class="hint">${left}</span>` : ''}
      <input class="code" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" data-keep="sms" required placeholder="······"></label>
      <button class="btn primary lg block" style="margin-top:12px" ${o.smsCode ? 'disabled' : ''}>${o.smsCode ? 'Sent, checking…' : 'Send code'}</button>
      ${st.household.codeTo ? '' : '<p class="tiny muted" style="margin:10px 0 0">Choose who gets the code in <a href="#/settings">Settings › Order helper</a>, so the right phone is told.</p>'}</form>`;
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
  if (['review', 'placing', 'placed', 'trial_done'].includes(o.state) || (o.basket && ['failed', 'needs_you'].includes(o.state))) html += review(o);

  // Once it's placed, the step-by-step progress is history: tuck it away.
  const stepsHtml = `<ul class="steps">` + STEPS.map(([k, label], i) => { const c = i < idx || o.state === 'placed' ? 'done' : i === idx ? 'now' : ''; return `<li class="${c}"><span class="dot">${c === 'done' ? icon('check') : ''}</span>${label}</li>`; }).join('') + `</ul>`;
  if (!['placed', 'trial_done'].includes(o.state)) html += section('Progress') + `<div class="card flush">${stepsHtml}</div>`;
  if (![...DONE_STATES, 'review'].includes(o.state)) html += `<div class="row end" style="margin-top:4px"><button class="btn small ghost danger" data-act="cancelOrder">Cancel order</button></div>`;
  if (['failed', 'cancelled', 'trial_done'].includes(o.state) && !o.notStarted) html += o.trial || o.amend ? `<a class="btn primary block" href="#/week">Back to the next shop</a>` : `<a class="btn primary block" href="#/shop">Back to the basket to try again</a>`;
  if (o.state === 'placed') html += placedActions(o);
  if (o.log?.length) html += `<details class="card flush disclosure" style="margin-top:12px"><summary>${icon('list')} Details</summary><ul class="list compact small">${o.log.slice(-20).map(l => `<li class="muted">${esc(l)}</li>`).join('')}</ul></details>`;
  html += `<a class="btn ghost block" href="#/history" style="margin-top:12px">${icon('list')} All orders</a>`;
  return html;
};

// What needs a decision comes first (not added, offer swaps, things in the
// basket that weren't in this shop), then the total; the full basket is folded away.
function review(o) {
  let html = '';
  const b = o.basket || {};
  const items = b.items || [];
  const canChange = o.state === 'review' && !o.approvedBy;
  const missing = (o.lines || []).filter(l => l.result && l.result !== 'added');
  if (missing.length) html += `<div class="notice warn">${icon('alert')}<span class="grow"><b>${missing.length} not added</b><ul class="list compact" style="margin:6px -16px -10px">${missing.map(l => `<li><span class="grow"><span class="name">${esc(l.name)}</span><span class="meta" style="color:inherit;opacity:.8">${esc(l.result === 'not_found' ? 'Not found' : l.result === 'unavailable' ? 'Unavailable' : l.result)}</span></span></li>`).join('')}</ul></span></div>`;
  // Offer swaps: what came in because it's on offer, what it replaced, the saving, and one tap to switch back.
  const swaps = (o.lines || []).filter(l => l.swap && l.result === 'added');
  const undone = (o.lines || []).filter(l => l.undone);
  const asked = new Set(o.undoSwaps || []);
  if (swaps.length || undone.length) {
    const saved = swaps.reduce((t, l) => t + (l.swap.saving || 0), 0);
    html += section('Swapped for offers', { count: swaps.length, right: saved ? `<span class="price" style="color:var(--ok)">−${money(saved)}</span>` : '' });
    html += `<div class="card flush"><ul class="list">` + swaps.map(l => {
      const waiting = asked.has(l.key) && !l.swap.failed;
      return `<li><span class="grow"><span class="name">${esc(l.product)}${(l.qty || 1) > 1 ? `<span class="qty">×${l.qty}</span>` : ''}</span>
        <span class="meta">On offer${l.swap.offer ? `: <b style="color:var(--warm)">${esc(l.swap.offer)}</b>` : ''} · saves about ${money(l.swap.saving)}</span>
        <span class="meta">Instead of ${esc(l.swap.from)}</span>
        ${l.swap.error ? `<span class="meta" style="color:var(--danger)">${esc(l.swap.error)}</span>` : ''}</span>
        ${o.state === 'review' && !l.swap.failed ? `<button class="btn small outline" data-act="undoSwap" data-id="${esc(l.key)}" ${waiting ? 'disabled' : ''}>${waiting ? 'Switching…' : 'Switch back'}</button>` : ''}</li>`;
    }).join('') + undone.map(l => `<li><span class="grow"><span class="name">${esc(l.product)}${(l.qty || 1) > 1 ? `<span class="qty">×${l.qty}</span>` : ''}</span><span class="meta">Switched back from ${esc(l.undone.product)} (the offer would have saved ${money(l.undone.saving)})</span></span><span class="pill">Your usual</span></li>`).join('') + `</ul></div>`;
  }
  // In the basket but not from this shop: left there from before (or, when
  // adding to an order, what's already in it).
  const ours = new Set((o.lines || []).filter(l => l.result === 'added').map(l => String(l.uid)));
  const extra = items.filter(i => i.uid != null && !ours.has(String(i.uid)));
  const removing = new Set((o.removeExtras || []).map(String));
  if (extra.length) {
    html += section(o.amend ? 'Already in the order' : 'Already in the basket', { count: extra.length, right: `<span class="price">${money(extra.reduce((t, i) => t + (i.total || 0), 0))}</span>` });
    html += `<div class="card flush">${o.amend ? '' : `<p class="small muted" style="margin:0;padding:12px 16px 0">These were in your Sainsbury's basket before and will be ordered too. Remove any you don't want.</p>`}
      <ul class="list compact">${extra.map(i => `<li><span class="grow"><span class="name">${esc(i.name)}${i.qty > 1 ? `<span class="qty">×${i.qty}</span>` : ''}</span>${i.change ? `<span class="meta${i.change > 0 ? ' up' : ''}">${changeText(i.change)}</span>` : ''}</span><span class="price">${money(i.total)}</span>
        ${canChange && !o.amend ? `<button class="btn small outline" data-act="removeExtra" data-id="${esc(i.uid)}" ${removing.has(String(i.uid)) ? 'disabled' : ''}>${removing.has(String(i.uid)) ? 'Removing…' : 'Remove'}</button>` : ''}</li>`).join('')}</ul></div>`;
  }
  // Price rises since the last time each was bought (worker/run.mjs, meta/prices).
  const ups = items.filter(i => i.change > 0);
  if (ups.length) {
    const more = ups.reduce((t, i) => t + i.change * (i.qty || 1), 0);
    html += `<details class="notice flush-details" data-toggle="upsOpen" ${keep.upsOpen ? 'open' : ''}><summary>${icon('tag')}<span class="grow"><b>${plural(ups.length, 'thing costs', 'things cost')} more than last time</b> · about ${money(more)} in all</span></summary>
      <ul class="list compact">${ups.map(i => `<li><span class="grow"><span class="name">${esc(i.name)}</span><span class="meta up">${changeText(i.change)}</span></span><span class="price">${money(i.total)}</span></li>`).join('')}</ul></details>`;
  }
  const refreshing = o.refreshAsked && o.refreshAsked > toMillis(o.refreshedAt);
  html += section('Total', { right: o.state === 'review' ? `<button class="btn small ghost" data-act="refreshTotal" ${refreshing || o.approvedBy ? 'disabled' : ''}>${icon('repeat')} ${refreshing ? 'Refreshing…' : 'Refresh'}</button>` : '' });
  html += `<div class="card flush"><div class="totals" style="border-top:0"><div class="row"><span>${plural(items.length, 'item')}</span><span class="spacer"></span><span class="price">${money(b.subtotal)}</span></div>
    ${b.savings ? `<div class="row"><span>Savings</span><span class="spacer"></span><span class="price" style="color:var(--ok)">−${money(b.savings)}</span></div>` : ''}
    <div class="row"><span>Delivery</span><span class="spacer"></span><span class="price">${money(b.delivery)}</span></div>
    <div class="total"><span>Total</span><span class="price">${money(o.total)}</span></div>
    ${o.state === 'review' ? `<p class="tiny muted" style="margin:8px 0 0">Changed something in the Sainsbury's app? Tap Refresh to read the basket again.</p>` : ''}
    ${o.card ? `<p class="small muted" style="margin:8px 0 0">${o.trial ? `Sainsbury's checkout showed ${money(o.checkoutTotal)} with ${esc(o.card)}. Nothing was paid.` : `Paid with ${esc(o.card)} on delivery day. Substitutions off.`}</p>` : ''}</div>
    <details class="disclosure" data-toggle="basketOpen" ${keep.basketOpen ? 'open' : ''} style="border-top:1px solid var(--line)"><summary>${icon('bag')} Everything in the ${o.amend ? 'order' : 'basket'} <span class="count">${items.length}</span></summary>
    <ul class="list compact">` + items.map(i => `<li><span class="grow"><span class="name">${esc(i.name)}${i.qty > 1 ? `<span class="qty">×${i.qty}</span>` : ''}</span>${i.offer ? `<span class="meta" style="color:var(--warm)">${esc(i.offer)}</span>` : ''}${i.change ? `<span class="meta${i.change > 0 ? ' up' : ''}">${changeText(i.change)}</span>` : ''}${swaps.some(l => String(l.uid) === String(i.uid)) ? `<span class="meta">Swapped in for an offer</span>` : ''}</span><span class="price">${money(i.total)}</span></li>`).join('') + `</ul></details></div>`;
  if (o.state === 'review') {
    const switching = swaps.some(l => asked.has(l.key) && !l.swap.failed) || refreshing || extra.some(i => removing.has(String(i.uid)));
    const label = o.approvedBy ? (o.trial ? 'Checking out…' : o.amend ? 'Updating…' : 'Placing…') : switching ? 'Updating the total…' : o.trial ? `Check out (trial, ${money(o.total)})` : o.amend ? `Update order, ${money(o.total)}` : `Approve ${money(o.total)}`;
    const note = o.trial ? 'Goes to Sainsbury\'s checkout and reads the total, but doesn\'t press Place order. Nothing is paid.' : o.amend ? 'Approving saves the changes to your Sainsbury\'s order.' : 'Approving places the order with Sainsbury\'s. You can still add to it here until the evening before delivery.';
    html += `<div class="actionbar col"><div><p class="small muted" style="margin:0 0 10px">${note}</p>
      <div class="row nowrap"><button class="btn outline danger" data-act="cancelOrder">Cancel</button>
      <button class="btn primary lg" style="flex:1" data-act="approve" ${o.approvedBy || switching ? 'disabled' : ''}>${label}</button></div></div></div>`;
  }
  return html;
}

function placedActions(o) {
  let html = '';
  const added = (o.amendedBy || []).length;
  if (added) html += `<p class="small muted" style="margin:0 4px 12px">Added to ${added === 1 ? 'once' : `${added} times`} since it was placed. The total above is the latest.</p>`;
  // Forgotten something: add the list to the order, until the day before delivery.
  if (!o.trial && !o.amend && o.deliveryDate > today()) {
    const open = st.list.filter(i => !i.done).length;
    html += `<div class="card"><b>Forgot something?</b><p class="small muted" style="margin:2px 0 12px">${open ? `Add the ${plural(open, 'thing')} on the list to this order.` : 'Add it to the list, then add the list to this order.'} Sainsbury's lets you change it until late the evening before delivery.</p>
      <div class="row">${open ? `<button class="btn tonal" data-act="amendOrder" data-id="${esc(o.id)}">${icon('plus')} Add to this order</button>` : ''}<a class="btn outline" href="#/list">Open the list</a></div></div>`;
  }
  if (o.amend?.of) html += `<a class="btn outline block" href="#/order/${esc(o.amend.of)}" style="margin-top:8px">See the whole order</a>`;
  else if (!o.trial) html += `<a class="btn primary block" href="#/cook" style="margin-top:12px">${icon('book')} Recipes for these dinners</a>`;
  html += `<a class="btn outline block" href="#/week" style="margin-top:8px">Back to the next shop</a>`;
  return html;
}

actions.code = f => {
  const code = f.code.value.replace(/\D/g, '');
  if (code.length !== 6) { toast('The code is 6 digits'); return; }
  keep.sms = '';
  run(() => S.updateH(['orders', curOrder().id], { smsCode: code, smsBy: S.me() }));
};
actions.slot = el => run(() => S.updateH(['orders', curOrder().id], { slotChoice: el.dataset.id, slotBy: S.me() }));
actions.undoSwap = el => run(() => S.updateH(['orders', curOrder().id], { undoSwaps: S.arrayUnion(el.dataset.id) }));
actions.refreshTotal = () => run(() => S.updateH(['orders', curOrder().id], { refreshAsked: Date.now() }), 'Reading the basket again…');
actions.removeExtra = el => {
  const o = curOrder(); const i = (o.basket?.items || []).find(x => String(x.uid) === el.dataset.id);
  if (!confirm(`Take ${i?.name || 'this'} out of the basket?`)) return;
  run(() => S.updateH(['orders', o.id], { removeExtras: S.arrayUnion(el.dataset.id) }));
};
actions.approve = () => {
  const o = curOrder();
  if (!confirm(o.trial ? `Go to Sainsbury's checkout for ${money(o.total)}? This is a trial: it won't place the order.` : o.amend ? `Update the order to ${money(o.total)}?` : `Place the order for ${money(o.total)}?`)) return;
  run(() => S.updateH(['orders', o.id], { approvedBy: S.me(), approvedTotal: o.total }));
};
actions.cancelOrder = () => {
  const o = curOrder();
  if (!confirm(o.amend ? 'Stop adding to the order? Anything added is taken out again.' : 'Cancel this order? The slot is released and the basket is left as it is.')) return;
  run(() => S.updateH(['orders', o.id], { cancelRequested: S.me() }));
};
actions.amendOrder = el => {
  const o = st.orders.find(x => x.id === el.dataset.id);
  if (o && confirm('Add everything on the list to this order? You\'ll need the SMS code, and you approve the new total.')) startAmend(o);
};
actions.retryOrder = () => run(async () => {
  const o = curOrder();
  if (o.state === 'requested') {
    await S.updateH(['orders', o.id], { state: 'cancelled', notStarted: true, message: 'Cancelled because the order helper didn\'t start. Nothing happened on Sainsbury\'s.' });
    await new Promise(r => setTimeout(r, 100));
  }
  const of = o.amend && st.orders.find(x => x.id === o.amend.of);
  if (of) await startAmend(of); else await startOrder(!!o.trial);
});

// The SMS countdown and the "didn't start" check change with time, not data.
setInterval(() => {
  if (route !== 'order' || document.hidden) return;
  const o = curOrder();
  if (o && ['need_code', 'requested'].includes(o.state)) render();
}, 30e3);
