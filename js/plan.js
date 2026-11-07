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
      put({ key, source: 'meal', uid: ing.uid || null, search: ing.search || ing.item, name: ing.item, ...(ing.product ? { product: ing.product, usual: true } : {}), qty: ing.qty || 1, for: [m.name] });
    }
  }
  for (const it of list) {
    if (it.done) continue;
    put({ key: `list:${it.id}`, source: 'list', uid: it.uid || null, search: it.text, name: it.text, ...(it.product ? { product: it.product } : {}), qty: it.qty || 1, listId: it.id });
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

// "Your usual": match a typed list item ("shampoo", "shower gel x2") to the
// products the household has bought before. products is [{ u: uid, n: name,
// c: times bought, l: last bought 'YYYY-MM-DD' }]. Every typed word must be in
// the product name (plurals and a few common other names allowed). The usual
// is the most recently bought of those bought at least twice, so a brand you
// switched to beats one you bought a lot years ago; failing that, the most
// recent. Returns the matches in that order (best first), at most `max`.
const SAME = [['shower gel', 'body wash'], ['hand soap', 'hand wash'], ['loo roll', 'toilet tissue', 'toilet roll'], ['washing up liquid', 'washing up', 'dish soap'], ['nappies', 'nappy'], ['loo cleaner', 'toilet cleaner'], ['softener', 'fabric conditioner'], ['clingfilm', 'cling film'], ['tinfoil', 'foil'], ['bin bag', 'bin liner', 'refuse sack']];
const words = s => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
const stem = w => w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && /(ches|shes|sses|xes|oes)$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
function variants(text) {
  const t = ' ' + words(text).join(' ') + ' ';
  const out = [t];
  for (const g of SAME) for (const a of g) if (t.includes(` ${a} `)) for (const b of g) if (b !== a) out.push(t.replace(` ${a} `, ` ${b} `));
  return out.map(v => v.trim().split(' ').map(stem));
}
export function matchUsual(text, products = [], max = 6) {
  if (!text || !products.length) return [];
  const qs = variants(text);
  const hits = products.filter(p => {
    const have = new Set(words(p.n || '').map(stem));
    return qs.some(q => q.length && q.every(w => have.has(w)));
  });
  const rank = p => [(p.c || 0) >= 2 ? 1 : 0, p.l || ''];
  hits.sort((a, b) => { const [ra, la] = rank(a), [rb, lb] = rank(b); return rb - ra || lb.localeCompare(la) || (b.c || 0) - (a.c || 0); });
  return hits.slice(0, max);
}

// Add a bought line to the products list (for "your usual" next time).
export function recordBought(products = [], uid, name, date) {
  const out = products.slice();
  const i = out.findIndex(p => String(p.u) === String(uid));
  if (i >= 0) out[i] = { ...out[i], n: name || out[i].n, c: (out[i].c || 0) + 1, l: date > (out[i].l || '') ? date : out[i].l };
  else out.push({ u: String(uid), n: name || '', c: 1, l: date });
  return out;
}

// Past products that might be a recipe ingredient, for Claude to choose from:
// ones matching all its words, then ones matching its last word ("Baby
// potatoes" also offers the other potatoes they buy).
export function usualCandidates(item, products = [], max = 15) {
  const w = words(item);
  const out = [...matchUsual(item, products, max)];
  if (w.length > 1) for (const p of matchUsual(w[w.length - 1], products, max)) if (!out.includes(p)) out.push(p);
  return out.slice(0, max);
}
