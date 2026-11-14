// The shared shopping list.
import * as S from '../store.js?v=12';
import { matchUsual } from '../plan.js?v=12';
import { icon } from '../ui.js?v=12';
import { st, esc, fmtDay, head, section, empty, run, render, keep, routes, actions } from '../core.js?v=12';
import { usual } from '../state.js?v=12';

routes.list = () => {
  const items = st.list;
  const open = items.filter(i => !i.done).length;
  let html = head('Shopping list', { eyebrow: 'Shared', sub: 'Add things as you run out. They go in the next shop with the dinners and staples.' });
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
};

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
