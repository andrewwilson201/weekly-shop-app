// Staples: things bought regularly, learned from past orders.
import * as S from '../store.js?v=9';
import { addDays, stapleStatus, skipRule } from '../plan.js?v=9';
import { icon } from '../ui.js?v=9';
import { st, esc, fmtDay, today, head, section, empty, run, keep, routes, actions } from '../core.js?v=9';
import { deliveryDate } from '../state.js?v=9';
import { libTabs } from './meals.js?v=9';

// Only what's due is open; the rest is folded away so the screen stays short.
const GROUPS = [['add', 'Due this shop'], ['suggest', 'For meals, when needed'], ['not_due', 'Not due yet'], ['lapsed', 'Not bought lately'], ['dropped', 'Turned off']];
const how = s => [skipRule(s) === 'every_week' ? 'Every week' : s.every_days ? `About every ${s.every_days} days` : '', s.last_bought ? `last ${fmtDay(s.last_bought)}` : ''].filter(Boolean).join(' · ');
function row(s) {
  const swaps = st.household.cheaperSwaps !== false;
  const more = [
    s.skips ? `<span class="meta">Left out ${s.skips}× running</span>` : '',
    s.freqNote ? `<span class="meta" style="color:var(--ok)">${esc(s.freqNote)}</span>` : '',
    swaps ? `<span class="meta">${s.keep ? 'Always this one, never swapped · ' : ''}<button class="link" data-act="keepStaple" data-id="${s.id}">${s.keep ? 'Allow cheaper swaps' : 'Always this one'}</button></span>` : '',
    s.times_bought ? `<span class="meta">Bought ${s.times_bought}×${(s.history || []).length ? `: ${[...s.history].reverse().slice(0, 12).map(x => `${fmtDay(x.date)}${x.qty > 1 ? ` ×${x.qty}` : ''}`).join(' · ')}` : ''}</span>` : '',
  ].filter(Boolean).join('');
  return `<li data-name="${esc(s.name.toLowerCase())}"><span class="grow"><span class="name">${esc(s.name)}${(s.quantity || 1) > 1 ? `<span class="qty">×${s.quantity}</span>` : ''}</span>
    <span class="meta">${how(s)}</span>
    ${s.learned && s.skips >= 3 ? `<span class="meta" style="color:var(--warm)">${esc(s.learned)} · <button class="link" data-act="resetSkips" data-id="${s.id}">Undo</button></span>` : ''}
    ${more ? `<details class="mini" data-toggle="st-${s.id}" ${keep[`st-${s.id}`] ? 'open' : ''}><summary>More</summary>${more}</details>` : ''}</span>
    <input type="checkbox" class="switch" data-change="dropStaple" data-id="${s.id}" ${s.dropped ? '' : 'checked'} aria-label="${s.dropped ? 'Turn on' : 'Turn off'} ${esc(s.name)}"></li>`;
}
routes.staples = () => {
  const d = deliveryDate() || addDays(today(), 2);
  const rows = st.staples.map(s => ({ s, status: stapleStatus(s, d) }));
  let html = libTabs('staples') + head('Staples', { sub: `Things you buy regularly, learned from your orders. The ones due go in the shop for ${fmtDay(d)} automatically. Switch one off to stop buying it.` });
  if (!rows.length) return html + `<div class="card">${empty('layers', 'No staples yet', 'Import them from your order history in Settings.', '<a class="btn primary" href="#/settings">Open Settings</a>')}</div>`;
  html += `<div class="search" style="margin-bottom:4px">${icon('search')}<input type="search" placeholder="Search staples" data-keep="stapleSearch" data-filter="stapleList" aria-label="Search staples"></div>`;
  html += `<div id="stapleList">`;
  for (const [status, title] of GROUPS) {
    const g = rows.filter(r => r.status === status).sort((a, b) => a.s.name.localeCompare(b.s.name));
    if (!g.length) continue;
    const list = `<ul class="list">${g.map(({ s }) => row(s)).join('')}</ul>`;
    if (status === 'add') html += `<div data-group="${status}">${section(title, { count: g.length })}<div class="card flush">${list}</div></div>`;
    else html += `<details class="card flush disclosure" style="margin-top:12px" data-group="${status}" data-toggle="grp-${status}" ${keep[`grp-${status}`] ? 'open' : ''}><summary>${title} <span class="count">${g.length}</span></summary>${list}</details>`;
  }
  return html + `</div>`;
};
actions.resetSkips = el => run(() => S.updateH(['staples', el.dataset.id], { skips: 0, learned: S.deleteField(), skipped_on: S.deleteField() }));
actions.keepStaple = el => run(() => { const s = st.staples.find(x => x.id === el.dataset.id); return S.updateH(['staples', s.id], { keep: !s.keep }); }, 'Saved');
actions.dropStaple = el => run(() => { const s = st.staples.find(x => x.id === el.dataset.id); return S.updateH(['staples', s.id], { dropped: !s.dropped }); });
