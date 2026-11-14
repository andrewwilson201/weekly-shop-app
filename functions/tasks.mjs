// The scheduled jobs' work, kept apart from index.mjs so the tests can call
// them directly (index.mjs should export only Firebase triggers).
import { notify } from './shared/worker/notify.mjs';
import { households } from './shared/worker/access.mjs';
import { iso, addDays } from './shared/js/plan.js';

export async function checkWorker(db, github, now = new Date()) {
  const res = await github('/actions/workflows/order-worker.yml/enable', { method: 'PUT' });
  if (!res.ok) console.error('Could not keep the order worker on', res.status, await res.text().catch(() => ''));
  // Fine-grained tokens report their expiry on every response, e.g. "2027-02-03 10:00:00 UTC".
  const probe = await github('');
  const raw = probe.headers.get('github-authentication-token-expiration');
  const expires = raw ? new Date(raw.replace(' UTC', 'Z').replace(' ', 'T')) : null;
  const ok = res.ok && probe.ok;
  const daysLeft = expires && !isNaN(expires) ? Math.floor((expires - now) / 864e5) : null;
  const status = { ok, checkedAt: now, expires: daysLeft == null ? null : iso(expires), ...(ok ? {} : { error: `GitHub said ${res.ok ? probe.status : res.status}` }) };
  for (const h of await households(db)) {
    await h.ref.set({ orderHelper: status }, { merge: true });
    if (!ok) await notify(h, { title: 'The order helper has stopped working', body: 'Its GitHub key was refused, so orders can\'t start. Settings › Order helper says how to fix it.', link: '#/settings', tag: 'helper' });
    else if (daysLeft != null && daysLeft <= 14) await notify(h, { title: `The order helper's key runs out in ${Math.max(0, daysLeft)} days`, body: 'Make a new GitHub key before then, or orders will stop starting. Settings › Order helper says how.', link: '#/settings', tag: 'helper' });
  }
  return status;
}


export async function remindCutoff(db, now = new Date()) {
  const tomorrow = addDays(iso(now), 1);
  let sent = 0;
  for (const h of await households(db)) {
    // A delivery booked in the Sainsbury's app that this shop hasn't gone into yet.
    const plans = (await h.ref.collection('weeks').where('deliveryDate', '==', tomorrow).get()).docs
      .filter(d => d.data().booked && !['ordered', 'closed'].includes(d.data().status) && !d.data().reminded);
    for (const p of plans) {
      await p.ref.update({ reminded: new Date() });
      await notify(h, { title: 'Your Sainsbury\'s delivery is tomorrow', body: 'You booked it in the Sainsbury\'s app. Tap to add this shop to it before the cut-off tonight.', link: '#/shop', tag: 'cutoff' });
      sent++;
    }
    const orders = (await h.ref.collection('orders').where('deliveryDate', '==', tomorrow).get()).docs
      .filter(d => d.data().state === 'placed' && !d.data().trial && !d.data().amend && !d.data().reminded);
    if (!orders.length) continue;
    const waiting = (await h.ref.collection('list').get()).docs.filter(d => !d.data().done && !d.data().orderedIn).length;
    const o = orders[0];
    await o.ref.update({ reminded: new Date() });
    if (!waiting) continue;
    await notify(h, { title: 'Last chance to add to tomorrow\'s delivery', body: `${waiting} thing${waiting === 1 ? ' is' : 's are'} on the list. Tap to add ${waiting === 1 ? 'it' : 'them'} to the order before the cut-off tonight.`, link: `#/order/${o.id}`, tag: 'cutoff' });
    sent++;
  }
  return sent;
}
