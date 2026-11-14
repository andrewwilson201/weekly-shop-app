// Order history: every order placed through the app, with spend by month and
// what the offer swaps saved.
import * as S from '../store.js?v=13';
import { icon } from '../ui.js?v=13';
import { st, esc, money, fmtDay, plural, head, section, empty, render, routes } from '../core.js?v=13';
import { olderOrders, slotText } from '../state.js?v=13';

let loaded = null, loading = false, failed = '';
function load() {
  if (loading) return;
  loading = true; failed = '';
  S.allOrders().then(all => { loaded = all; all.forEach(o => olderOrders.set(o.id, o)); })
    .catch(e => { failed = e.message || 'Couldn\'t load the orders'; })
    .finally(() => { loading = false; render(); });
}
const monthOf = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' });

routes.history = () => {
  // Loaded fresh each time the screen is opened; the live orders fill in meanwhile.
  if (!loaded && !loading && !failed) load();
  const byId = new Map([...(loaded || []), ...st.orders].map(o => [o.id, o]));
  // An "Add to this order" run updates the original's total, so it isn't counted again.
  const placed = [...byId.values()].filter(o => o.state === 'placed' && !o.trial && !o.amend && o.deliveryDate)
    .sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate));
  let html = `<a class="btn small ghost" href="#/order" style="margin:8px 0 0 -6px">${icon('back')} Order</a>` + head('Order history', { sub: 'Every shop ordered through the app.' });
  if (failed) html += `<div class="notice danger">${icon('alert')}<span class="grow">${esc(failed)}</span></div>`;
  if (!placed.length) return html + (loading || !loaded ? '<div class="loading"><span class="spinner"></span></div>' : `<div class="card">${empty('cart', 'No orders yet', 'Orders placed from the app are listed here with what they cost.')}</div>`);

  const spent = placed.reduce((t, o) => t + (Number(o.total) || 0), 0);
  const saved = placed.reduce((t, o) => t + (o.lines || []).reduce((s, l) => s + (l.swap && l.result === 'added' ? Number(l.swap.saving) || 0 : 0), 0), 0);
  html += `<div class="stats">
    <div class="stat"><b>${money(spent / placed.length)}</b><span>Average shop</span></div>
    <div class="stat"><b>${placed.length}</b><span>${placed.length === 1 ? 'Order' : 'Orders'}</span></div>
    <div class="stat"><b>${money(saved)}</b><span>Saved by offer swaps</span></div></div>`;

  const months = [...new Set(placed.map(o => monthOf(o.deliveryDate)))];
  for (const mo of months) {
    const g = placed.filter(o => monthOf(o.deliveryDate) === mo);
    html += section(mo, { count: g.length, right: `<span class="price">${money(g.reduce((t, o) => t + (Number(o.total) || 0), 0))}</span>` });
    html += `<div class="card flush"><ul class="list">${g.map(o => `<li class="link-row"><a href="#/order/${esc(o.id)}" class="grow"><span class="name">${fmtDay(o.deliveryDate, { weekday: 'short', day: 'numeric', month: 'short' })}${o.slot ? `, ${slotText(o)}` : ''}</span>
      <span class="meta">${plural((o.basket?.items || []).length, 'item')}${(o.meals || []).length ? ` · ${plural(o.meals.length, 'dinner')}` : ''}${(o.amendedBy || []).length ? ' · added to later' : ''}${o.requestedBy?.name ? ` · ${esc(o.requestedBy.name.split(' ')[0])}` : ''}</span></a>
      <span class="price">${money(o.total)}</span></li>`).join('')}</ul></div>`;
  }
  return html;
};
// Opened again: load again.
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#/history')) { loaded = null; failed = ''; } });
