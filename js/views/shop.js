// Basket: everything going in the shop, from the dinners, the staples due and
// the list, before it's sent to Sainsbury's.
import * as S from '../store.js?v=12';
import { addDays, stapleStatus, AISLES, aisleOf, estimateShop } from '../plan.js?v=12';
import { icon } from '../ui.js?v=12';
import { st, esc, money, fmtDay, today, plural, head, section, run, keep, routes, actions } from '../core.js?v=12';
import { plan, savePlan, activeOrder, stateLabel, flow, shopLines, pickedMeals, startOrder } from '../state.js?v=12';

const MIN_BASKET = 25;
// Each line has − / + for how many; − at 1 leaves it out (like unticking).
const lineRow = l => `<li><input type="checkbox" class="check" checked data-change="lineOff" data-id="${esc(l.key)}" aria-label="Include">
  <span class="grow"><span class="name">${esc(l.name)}</span>${l.product ? `<span class="meta">${esc(l.product)}</span>` : ''}${l.for ? `<span class="meta">${esc(l.for.join(' · '))}</span>` : ''}</span>
  <span class="stepper"><button class="step" data-act="qty" data-id="${esc(l.key)}" data-q="${l.qty - 1}" aria-label="${l.qty > 1 ? 'One fewer' : 'Leave out'} ${esc(l.name)}">${icon(l.qty > 1 ? 'minus' : 'x')}</button><b aria-label="Quantity">${l.qty}</b><button class="step" data-act="qty" data-id="${esc(l.key)}" data-q="${l.qty + 1}" aria-label="One more ${esc(l.name)}">${icon('plus')}</button></span></li>`;
routes.shop = () => {
  const w = plan();
  const order = activeOrder();
  if (order) return head('Basket') + flow('shop') + `<a class="notice info" href="#/order">${icon('truck')}<span class="grow"><b>An order is in progress</b><br>${esc(stateLabel(order.state))}. The basket can't change until it's finished.</span>${icon('chevron', 'chev')}</a>`;
  const lines = shopLines();
  const extras = w?.extras || {};
  let html = head('Basket', { eyebrow: w?.deliveryDate ? `Delivery ${fmtDay(w.deliveryDate, { weekday: 'long', day: 'numeric', month: 'long' })}` : 'Next shop', sub: 'Everything that will go in the Sainsbury\'s basket, by aisle. Untick anything you don\'t need, then send it.' }) + flow('shop');
  if (!w?.deliveryDate) html += `<a class="notice warn" href="#/week">${icon('calendar')}<span class="grow"><b>Choose a delivery day first</b><br>It decides which staples are due.</span>${icon('chevron', 'chev')}</a>`;
  const by = src => lines.filter(l => l.source === src);

  const staples = by('staple');
  const skipped = Object.entries(extras).filter(([k, v]) => k.startsWith('staple:') && v === false).length;
  html += section('Staples due', { count: staples.length, right: `${staples.length ? '<button class="btn small ghost" data-act="skipStaples">Skip all staples</button>' : ''}${skipped ? `<button class="btn small ghost" data-act="unskipStaples">Put back ${skipped}</button>` : ''}` });
  if (!staples.length) html += `<div class="card soft"><p class="small muted">${st.staples.length ? 'None due for this delivery.' : 'No staples yet. Import them in Settings.'}</p></div>`;
  else html += `<details class="card flush disclosure" ${keep.staplesOpen ? 'open' : ''} data-toggle="staplesOpen"><summary>${icon('layers')} ${plural(staples.length, 'staple')} due, from your past orders</summary><ul class="list inset-check">${byAisle(staples)}</ul></details>`;

  const meals = by('meal');
  html += section('For the meals', { count: meals.length });
  html += meals.length ? `<div class="card flush"><ul class="list inset-check">${byAisle(meals)}</ul></div>` : `<div class="card soft"><p class="small muted">No meals picked yet. <a href="#/week">Pick dinners</a>.</p></div>`;
  const list = by('list');
  html += section('From the list', { count: list.length });
  // Anything else goes on the shared list from here too.
  html += `<form data-form="addItem" class="inputrow" style="margin-bottom:10px"><input type="text" name="text" data-keep="newItem" placeholder="Add something else, e.g. milk x2" autocomplete="off" enterkeyhint="done" aria-label="Add an item"><button class="btn tonal" aria-label="Add">${icon('plus')} Add</button></form>`;
  html += list.length ? `<div class="card flush"><ul class="list inset-check">${byAisle(list)}</ul></div>` : '';

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
  // About what it'll cost, from the prices paid last time (meta/prices).
  const est = estimateShop(lines, st.prices);
  // An order already booked is over the minimum with or without this shop.
  const low = !w?.booked && lines.length && (est.unknown === 0 ? est.total < MIN_BASKET : est.known === 0 && lines.length < 6);
  if (low) html += `<div class="notice warn" style="margin-top:12px">${icon('alert')}<span class="grow"><b>This looks under £${MIN_BASKET}</b><br>Sainsbury's has a minimum basket of £${MIN_BASKET} for delivery, so the order may not go through. Add a few things, or leave it for a day or two.</span></div>`;
  const about = est.known ? `About ${money(est.total)}${est.unknown ? `, plus ${est.unknown} not priced yet` : ''}` : 'You approve the total before paying';
  html += `<div class="actionbar"><div><span class="sum"><b>${plural(lines.length, 'item')}</b><span>${about}</span></span>
    <button class="btn primary" data-act="order" ${w?.deliveryDate && lines.length ? '' : 'disabled'}>${icon('cart')} ${w?.booked ? 'Add to my Sainsbury\'s order' : 'Send to Sainsbury\'s'}</button></div></div>`;
  return html;
};
// Rows under aisle subheadings, the way the shop is laid out.
function byAisle(lines) {
  const groups = AISLES.map(([key, label]) => [label, lines.filter(l => aisleOf(l) === key)]).filter(([, g]) => g.length);
  if (groups.length < 2) return lines.map(lineRow).join('');
  return groups.map(([label, g]) => `<li class="aisle">${label}</li>${g.map(lineRow).join('')}`).join('');
}
const setExtra = (key, val) => savePlan({ extras: { [key]: val } });
actions.skipStaples = () => run(() => savePlan({ extras: Object.fromEntries(shopLines().filter(l => l.source === 'staple').map(l => [l.key, false])) }), 'Staples skipped for this shop');
actions.unskipStaples = () => run(() => savePlan({ extras: Object.fromEntries(Object.entries(plan()?.extras || {}).filter(([k, v]) => k.startsWith('staple:') && v === false).map(([k]) => [k, S.deleteField()])) }));
actions.lineOff = el => run(() => setExtra(el.dataset.id, false));
actions.qty = el => {
  const key = el.dataset.id, q = Number(el.dataset.q);
  if (q < 1) { run(() => setExtra(key, false)); return; }
  run(() => savePlan({ qtys: { [key]: q } }));
};
actions.lineOn = el => run(() => setExtra(el.dataset.id, true));
actions.order = () => startOrder(false);
