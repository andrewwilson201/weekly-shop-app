// The app's shell: shared helpers, the live state, routing, rendering and the
// tap/submit/change handlers. Each screen lives in js/views/ and registers its
// view in `routes` and its handlers in `actions`.
//
// Every module imports this file (and store.js, plan.js, ui.js) with the same
// ?v= query, so they all share one copy. Bump it in every import when any of
// the app's files change, so phones don't mix old and new files.
import * as S from './store.js?v=11';
import { iso } from './plan.js?v=11';
import { icon, avatar } from './ui.js?v=11';

export const $main = document.getElementById('main');
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = n => (n == null || isNaN(n) ? '' : `£${Number(n).toFixed(2)}`);
export const fmtDay = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'Europe/London' });
export const fmtTime = t => new Date(t).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London' }).replace(':00', '').replace(' ', '');
export const today = () => iso(new Date());
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
export const toMillis = t => (t?.toMillis ? t.toMillis() : t ? new Date(t).getTime() : 0);
export const head = (title, { eyebrow = '', sub = '', right = '' } = {}) => `<header class="page-head">${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}
  <div class="row nowrap"><h1>${title}</h1><span class="spacer"></span>${right}</div>${sub ? `<p>${sub}</p>` : ''}</header>`;
export const section = (title, { count = null, right = '' } = {}) => `<div class="section-head"><h2>${title}${count != null ? ` <span class="count">${count}</span>` : ''}</h2><span class="spacer"></span>${right}</div>`;
export const empty = (ic, title, text, action = '') => `<div class="empty"><div class="art">${icon(ic)}</div><h3>${title}</h3><p>${text}</p>${action}</div>`;

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
}
export async function run(fn, done) {
  try { await fn(); if (done) toast(done); } catch (e) { console.error(e); toast(friendly(e)); }
}
// Firestore's own wording isn't for people.
function friendly(e) {
  if (e?.code === 'permission-denied') return 'That isn\'t allowed. If you\'ve just been added to the household, close the app and open it again.';
  if (e?.code === 'unavailable') return 'You\'re offline. It\'ll be saved when you\'re back online.';
  return e?.message || 'Something went wrong';
}

// ---------- state, routing ----------
export let st = S.getState();
export let route = 'week', arg = null;
export const routes = {};
export const actions = {};
// Screens hook in here: `rendered` runs after every render, `leave` when the route changes.
export const hooks = { rendered: [], leave: [] };

// Inputs being typed into survive live re-renders.
export let keep = {};
export const resetKeep = () => { keep = {}; };

function parseHash() {
  const [, r = 'week', a = null] = (location.hash || '#/week').split('/');
  route = routes[r] ? r : 'week'; arg = a && decodeURIComponent(a);
}

function remember() {
  document.querySelectorAll('[data-keep]').forEach(el => { keep[el.dataset.keep] = el.type === 'checkbox' ? el.checked : el.value; });
  const a = document.activeElement;
  return a && a.dataset && a.dataset.keep ? { k: a.dataset.keep, s: a.selectionStart } : null;
}
function restore(focus) {
  document.querySelectorAll('[data-keep]').forEach(el => {
    const v = keep[el.dataset.keep]; if (v == null) return;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  document.querySelectorAll('[data-filter]').forEach(applyFilter);
  if (focus) {
    const el = document.querySelector(`[data-keep="${focus.k}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(focus.s, focus.s); } catch {} }
  }
}

// views: signIn and setup, for before there's a household (js/views/signin.js).
export const gate = {};
export function render() {
  const tabs = document.getElementById('tabs');
  const settings = document.getElementById('settingsLink');
  const ready = st.ready && st.user && st.household?.members;
  tabs.hidden = !ready; settings.hidden = !ready;
  document.getElementById('sync').textContent = navigator.onLine ? '' : 'Offline';
  document.getElementById('who').innerHTML = ready ? Object.entries(st.household.memberNames || {}).map(([uid, name]) => avatar({ uid, name })).join('') : '';
  const tab = { shop: 'week', order: 'week', history: 'week', recipe: 'cook', meal: 'meals', staples: 'meals' }[route] || route;
  tabs.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  const focus = remember();
  if (!st.ready) { $main.innerHTML = '<div class="loading"><span class="spinner"></span></div>'; return; }
  if (!st.user) { $main.innerHTML = gate.signIn(); bind(); return; }
  if (!st.household?.members) { $main.innerHTML = gate.setup(); bind(); return; }
  $main.innerHTML = routes[route]();
  bind();
  hooks.rendered.forEach(f => f());
  restore(focus);
}

function bind() {
  $main.querySelectorAll('form[data-form]').forEach(f => f.onsubmit = e => { e.preventDefault(); actions[f.dataset.form]?.(f, e); });
}

// Search boxes filter the rows of the list they name, without a re-render.
function applyFilter(el) {
  const q = el.value.trim().toLowerCase();
  const root = document.getElementById(el.dataset.filter);
  if (!root) return;
  // Every word typed must start a word of the name, so "spag bol" finds Spaghetti Bolognese.
  // data-max on the list caps how many matches show.
  const words = q.split(/\s+/).filter(Boolean);
  const max = Number(root.dataset.max) || Infinity;
  let shown = 0;
  root.querySelectorAll('li[data-name]').forEach(li => {
    const name = ` ${li.dataset.name.replace(/[^a-z0-9à-ÿ]+/g, ' ')}`;
    const hit = !q || li.dataset.name.includes(q) || words.every(w => name.includes(` ${w.replace(/[^a-z0-9à-ÿ]+/g, '')}`));
    li.hidden = !hit || ++shown > max;
  });
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

// Open meal categories are remembered until the app is closed, but not the ones a search opened.
export const openCats = new Set();

// Called once by app.js after every screen has registered itself.
export function start() {
  parseHash();
  window.addEventListener('hashchange', () => { parseHash(); keep = {}; hooks.leave.forEach(f => f()); render(); window.scrollTo(0, 0); });
  window.addEventListener('scroll', () => document.getElementById('topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  // Event delegation: elements carry data-act="name" and optional data-id.
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
  $main.addEventListener('toggle', e => {
    const el = e.target;
    if (!el.dataset?.cat || el.closest('[data-searching]')) return;
    if (el.open) openCats.add(el.dataset.cat); else openCats.delete(el.dataset.cat);
  }, true);
  $main.addEventListener('input', e => { const el = e.target; if (el.dataset?.keep) keep[el.dataset.keep] = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset?.filter) applyFilter(el); });
  S.onChange(s => { st = s; render(); });
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('online', render); window.addEventListener('offline', render);
  render();
}
