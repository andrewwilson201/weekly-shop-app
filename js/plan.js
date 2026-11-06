// Shared planning rules, used by the app and by the order worker (plain ES module, no DOM).
//
// Staples due rule (ported from build-staples.py v2):
//   every_week -> always added
//   when_due   -> added when last_bought + every_days <= delivery + 3 days,
//                 unless not bought for more than 2 x every_days + 7 days (probably dropped)
//   suggest    -> shown as a suggestion when due; added only if ticked

const DAY = 86400000;
const toDate = s => new Date(`${String(s).slice(0, 10)}T12:00:00Z`);
export const iso = d => new Date(d).toISOString().slice(0, 10);
export const addDays = (s, n) => iso(toDate(s).getTime() + n * DAY);
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);

// Holiday mode: away = [{ from, to }] (dates, inclusive).
export const awayOn = (away = [], date) => away.find(a => a.from <= date && date <= a.to) || null;
// A week's ideas are paused when you're away for most of it (4+ of its 7 days).
export function awayWeek(away = [], sunday) {
  let n = 0; for (let i = 0; i < 7; i++) if (awayOn(away, addDays(sunday, i))) n++;
  return n >= 4;
}

// The week a plan belongs to is named after its Sunday (the day ideas go out).
export function weekId(date = new Date()) {
  const d = toDate(iso(date));
  return iso(d.getTime() - d.getUTCDay() * DAY);
}

// Learning from the shop: a staple left out of an order is "skipped". Its next
// due date then counts from that order (skipped_on) instead of the last
// purchase, and 3 skips in a row turn it into a suggestion (see skipRule).
export const SKIPS_TO_SUGGEST = 3;
export function skipRule(s) {
  return (s.skips || 0) >= SKIPS_TO_SUGGEST && s.rule !== 'suggest' ? 'suggest' : s.rule;
}

export function stapleStatus(s, delivery) {
  if (s.dropped) return 'dropped';
  const rule = skipRule(s);
  if (s.skipped_on && daysBetween(s.skipped_on, delivery) < Math.min(7, s.every_days || 7)) return 'not_due';
  if (rule === 'every_week') return 'add';
  if (!s.last_bought || !s.every_days) return rule === 'suggest' ? 'suggest' : 'add';
  const since = daysBetween(s.last_bought, delivery);
  const from = s.skipped_on && s.skipped_on > s.last_bought ? s.skipped_on : s.last_bought;
  const due = daysBetween(from, delivery) + 3 >= s.every_days;
  if (!due) return 'not_due';
  if (since > 2 * s.every_days + 7 && !(s.skipped_on > s.last_bought)) return 'lapsed';
  return rule === 'suggest' ? 'suggest' : 'add';
}

// 10 ideas: favourites (most chosen) first, then meals not had for longest,
// skipping anything chosen in the last 2 weeks.
export function pickIdeas(meals, { count = 10, favourites = 4, today = iso(new Date()) } = {}) {
  const live = meals.filter(m => !m.archived);
  const recent = m => m.lastChosen && daysBetween(m.lastChosen, today) < 14;
  const favs = live.filter(m => (m.timesChosen || 0) > 0 && !recent(m))
    .sort((a, b) => (b.timesChosen || 0) - (a.timesChosen || 0) || String(a.lastChosen).localeCompare(String(b.lastChosen)))
    .slice(0, favourites);
  const rest = live.filter(m => !favs.includes(m) && !recent(m))
    .sort((a, b) => String(a.lastOffered || '').localeCompare(String(b.lastOffered || '')) || Math.random() - 0.5);
  const out = [...favs, ...rest].slice(0, count);
  if (out.length < count) out.push(...live.filter(m => !out.includes(m)).slice(0, count - out.length));
  return out.map(m => m.id);
}

// The week's shop: staples due + ingredients of the chosen meals + shared list items.
// Lines with the same product (or the same search term) are merged.
export function buildShop({ staples = [], meals = [], list = [], delivery, extras = {} }) {
  const lines = [];
  const byKey = new Map();
  const put = (line) => {
    const key = line.uid ? `uid:${line.uid}` : `q:${(line.search || line.name).toLowerCase()}`;
    const have = byKey.get(key);
    if (have) {
      // Two meals needing the same thing add up; a staple that a meal also needs doesn't.
      have.qty = have.source === 'meal' && line.source === 'meal' ? have.qty + (line.qty || 1) : Math.max(have.qty, line.qty || 1);
      have.for = [...new Set([...(have.for || []), ...(line.for || [])])];
      return;
    }
    byKey.set(key, line);
    lines.push(line);
  };
  for (const s of staples) {
    const st = stapleStatus(s, delivery);
    const on = extras[`staple:${s.id}`];
    if (st === 'add' && on !== false || (st !== 'add' && on === true)) {
      put({ key: `staple:${s.id}`, source: 'staple', uid: s.product_uid, name: s.name, qty: s.quantity || 1, status: st });
    }
  }
  for (const m of meals) {
    for (const ing of m.ingredients || []) {
      const key = `meal:${m.id}:${ing.item}`;
      // Store-cupboard things (oil, salt, stock...) only when ticked.
      if (extras[key] === false || (ing.pantry && extras[key] !== true)) continue;
      put({ key, source: 'meal', uid: ing.uid || null, search: ing.search || ing.item, name: ing.item, qty: ing.qty || 1, for: [m.name] });
    }
  }
  for (const it of list) {
    if (it.done) continue;
    put({ key: `list:${it.id}`, source: 'list', uid: it.uid || null, search: it.text, name: it.text, qty: it.qty || 1, listId: it.id });
  }
  return lines;
}

// After an order: what to record on a staple that was bought on `delivery`.
// Keeps a log of the last 30 purchases and re-learns how often it's bought:
// the gap since the last purchase moves the estimate 30% of the way, so one
// odd week doesn't swing it, but a real change shows within a few orders.
export function learnStaple(s, delivery, qty = 1) {
  const history = [...(s.history || []), { date: delivery, qty }].slice(-30);
  const update = { last_bought: delivery, times_bought: (s.times_bought || 0) + 1, history, skips: 0 };
  if (s.last_bought && s.last_bought < delivery && s.rule !== 'every_week') {
    const gap = daysBetween(s.last_bought, delivery);
    if (gap >= 3 && gap <= 180) {
      const was = s.every_days || gap;
      const now = Math.max(5, Math.round(0.7 * was + 0.3 * gap));
      update.every_days = now;
      if (Math.abs(now - was) >= 2) update.freqNote = `Now about every ${now} days (was ${was}), from your recent orders`;
    }
  }
  return update;
}
