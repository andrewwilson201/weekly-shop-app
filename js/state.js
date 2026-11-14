// What the screens work out from the live state: the plan for the next shop,
// its order, the shop lines, the dinners to cook.
import * as S from './store.js?v=13';
import { iso, addDays, buildShop, stapleStatus, matchUsual, toCook, currentPlanId, planCmp } from './plan.js?v=13';
import { icon } from './ui.js?v=13';
import { st, fmtDay, fmtTime, money, today, run, toMillis } from './core.js?v=13';

export const mealById = id => st.meals.find(m => m.id === id);

// ---------- the plan for the next shop ----------
// One plan per shop, not per calendar week (plan.js currentPlanId): it stays
// open until it's ordered, then the next one starts.
export const planId = () => currentPlanId(st.weeks, today());
export const plan = () => st.weeks[planId()];
// Save to the current plan, creating it if it's new (createdAt is how plans
// are listed, so a plan without one would vanish).
export const savePlan = data => S.setH(['weeks', planId()], plan() ? data : { offered: [], picks: {}, ...data, createdAt: S.serverTimestamp() });
export const deliveryDate = () => plan()?.deliveryDate || null;
export const pickedMeals = () => Object.keys(plan()?.picks || {}).map(mealById).filter(Boolean);
// How many the household cooks for (Settings › Household), for scaling recipes.
export const householdServes = () => Number(st.household?.serves) || 4;

// ---------- orders ----------
export const DONE_STATES = ['placed', 'failed', 'cancelled', 'trial_done'];
export const START_MINUTES = 15; // worker/run.mjs: a request older than this isn't started
export const activeOrder = () => st.orders.find(o => !DONE_STATES.includes(o.state));
// The current plan's order, running or placed.
export const planOrder = () => {
  const a = activeOrder();
  if (a && !a.trial && !a.amend) return a;
  return st.orders.find(o => o.state === 'placed' && o.week === planId() && !o.trial && !o.amend);
};
// The next delivery on its way (shown on the home screen until the day).
export const nextDelivery = () => st.orders
  .filter(o => o.state === 'placed' && !o.trial && !o.amend && o.deliveryDate >= today())
  .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))[0] || null;
// An order nobody's worker picked up: the worker won't start it late.
export const isStale = o => o?.state === 'requested' && toMillis(o.createdAt) && Date.now() - toMillis(o.createdAt) > START_MINUTES * 60e3;

export const STEPS = [
  ['requested', 'Starting the order helper'],
  ['logging_in', 'Logging in to Sainsbury\'s'],
  ['need_code', 'Enter the SMS code'],
  ['choose_slot', 'Choose a delivery time'],
  ['filling', 'Filling the basket'],
  ['review', 'Check the total and approve'],
  ['placing', 'Placing the order'],
  ['placed', 'Ordered'],
];
export const stateLabel = s => ({ failed: 'Stopped', cancelled: 'Cancelled', needs_you: 'Needs you', trial_done: 'Trial finished' }[s] || (STEPS.find(x => x[0] === s) || [, s])[1]);
export const slotText = o => (o.slot ? `${fmtTime(o.slot.start_time)}–${fmtTime(o.slot.end_time)}` : '');
export const orderLine = o => o.state === 'placed'
  ? `${fmtDay(o.deliveryDate)}${o.slot ? `, ${slotText(o)}` : ''}${o.total ? ` · ${money(o.total)}` : ''}`
  : stateLabel(o.state);

// The job is three steps: dinners, basket, order. Each screen in it shows the
// steps so it's clear where you are and what comes next.
export function flow(now) {
  const w = plan() || {};
  const o = planOrder();
  const done = { week: Object.keys(w.picks || {}).length > 0 && !!w.deliveryDate, shop: !!o, order: o?.state === 'placed' };
  return `<nav class="flow" aria-label="Steps for this shop">` + [['week', 'Dinners'], ['shop', 'Basket'], ['order', 'Order']].map(([r, label], i) =>
    `<a href="#/${r}" class="${r === now ? 'now' : ''}${done[r] ? ' done' : ''}"${r === now ? ' aria-current="step"' : ''}><span class="n">${done[r] && r !== now ? icon('check') : i + 1}</span>${label}</a>`).join('<span class="sep"></span>') + `</nav>`;
}

// ---------- the shop ----------
// "Your usual": which product a typed item becomes. A product picked by hand
// wins; "anyProduct" means let Sainsbury's search pick; otherwise the best
// match from past orders.
export function usual(it) {
  if (it.uid) return { uid: it.uid, name: it.product || it.text, picked: true };
  if (it.anyProduct) return null;
  const m = matchUsual(it.text, st.products, 1)[0];
  return m ? { uid: m.u, name: m.n } : null;
}
export function shopLines() {
  const w = plan() || {};
  const list = st.list.filter(it => !it.done).map(it => { const u = usual(it); return u ? { ...it, uid: u.uid, product: u.name } : it; });
  return buildShop({ staples: st.staples, meals: pickedMeals(), list, delivery: w.deliveryDate || addDays(today(), 2), extras: w.extras || {}, qtys: w.qtys || {}, serves: householdServes() });
}
const clean = l => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined));
// trial: Settings › Order helper › Trial run. Same shop, but it stops before Place order.
export const startOrder = trial => run(async () => {
  if (activeOrder()) { location.hash = '#/order'; return; }
  const w = trial ? { ...(plan() || {}), deliveryDate: plan()?.deliveryDate || addDays(today(), 2) } : plan();
  const lines = shopLines().map(clean);
  // Staples that would have been added but were unticked: the worker counts these as skips.
  const skippedStaples = st.staples.filter(s => (w.extras || {})[`staple:${s.id}`] === false && stapleStatus(s, w.deliveryDate) === 'add').map(s => s.id);
  if (trial && !lines.length) throw new Error('The shop is empty. Pick some dinners or add to the list first, so there\'s something to put in the basket.');
  await S.addH(['orders'], {
    week: planId(), deliveryDate: w.deliveryDate, state: 'requested', lines, skippedStaples: trial ? [] : skippedStaples, meals: trial ? [] : Object.keys(w.picks || {}),
    requestedBy: S.me(), createdAt: S.serverTimestamp(), log: [], ...(trial ? { trial: true } : {}),
    // Booked in the Sainsbury's app already: the worker adds to that order instead of booking a slot.
    ...(w.booked ? { booked: true } : {}),
  });
  if (!trial && !plan()) await savePlan({ deliveryDate: w.deliveryDate });
  location.hash = '#/order';
});
// "Add to this order": whatever is on the shared list now, added to a placed
// order before Sainsbury's cut-off (worker/run.mjs, amend).
export const startAmend = o => run(async () => {
  if (activeOrder()) { location.hash = '#/order'; return; }
  const list = st.list.filter(it => !it.done).map(it => { const u = usual(it); return u ? { ...it, uid: u.uid, product: u.name } : it; });
  const lines = buildShop({ list, delivery: o.deliveryDate }).map(clean);
  if (!lines.length) throw new Error('The list is empty. Add what you forgot to the list first, then tap Add to this order.');
  const ref = await S.addH(['orders'], {
    week: o.week, deliveryDate: o.deliveryDate, state: 'requested', lines, skippedStaples: [], meals: [],
    amend: { orderNumber: o.orderNumber || '', of: o.id }, slot: o.slot || null,
    requestedBy: S.me(), createdAt: S.serverTimestamp(), log: [],
  });
  location.hash = `#/order/${ref.id}`;
});

// ---------- dinners to cook ----------
// Dinners shopped for stay on Recipes until they're marked cooked, so the last
// shop's are still easy to find after the next one is ordered (toCook in plan.js).
export const cookList = () => toCook({ weeks: st.weeks, orders: st.orders, current: planId() }).filter(x => mealById(x.mealId));
// Dinners from earlier shops that have arrived and aren't cooked yet.
export const stillToCook = () => cookList().filter(x => !x.done && planCmp(x.week, planId()) < 0 && (!x.delivery || x.delivery <= today()));
export const hasMethod = m => !!m?.recipe?.steps?.length;
// Ask the functions (or the worker) for a meal's method: from its page, or written by Claude.
export function askRecipe(m) {
  if (!m || hasMethod(m) || m.recipeRequested) return;
  S.updateH(['meals', m.id], { recipeRequested: true, recipeMessage: S.deleteField() }).catch(e => console.error(e));
}
export { iso };

// Orders older than the 10 kept live, once Order history has loaded them.
export const olderOrders = new Map();
export const findOrder = id => st.orders.find(x => x.id === id) || olderOrders.get(id);
