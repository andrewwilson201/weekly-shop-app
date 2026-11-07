// Shared planning rules, used by the app and by the order worker (plain ES module, no DOM).
//
// Staples due rule (ported from build-staples.py v2):
//   every_week -> always added
//   when_due   -> added when last_bought + every_days <= delivery + 3 days,
//                 unless not bought for more than 2 x every_days + 7 days (probably dropped)
//   suggest    -> shown as a suggestion when due; added only if ticked

const DAY = 86400000;
const toDate = s => new Date(`${String(s).slice(0, 10)}T12:00:00Z`);
// Dates are UK dates: just after midnight in summer it's already tomorrow in
// London but still yesterday in UTC. (Dates at noon UTC, as below, are the same day either way.)
const UK = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
export const iso = d => UK.format(new Date(d));
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

// Dinners to cook, for the Recipes screen. Each dinner stays there until
// someone marks it cooked (or not making it), so last week's are still there
// after the next week's shop has been ordered. Which weeks count:
//   this week: its picks, ordered or not yet;
//   earlier weeks: the dinners of an order that went ahead (any order that
//   wasn't cancelled; a failed one may have been finished in Sainsbury's app).
//   Earlier weeks with no order at all are left out, since nothing was bought.
// weeks: { id: week doc }, orders: order docs, current: this week's id.
// Returns [{ week, mealId, ordered, delivery, done }], oldest week first.
export function toCook({ weeks = {}, orders = [], current }) {
  const out = [];
  for (const w of Object.values(weeks).sort((a, b) => a.id.localeCompare(b.id))) {
    if (w.id > current) continue;
    // A trial run (Settings › Order helper) buys nothing, so it doesn't count.
    const mine = orders.filter(o => o.week === w.id && o.state !== 'cancelled' && !o.trial);
    const placed = mine.find(o => o.state === 'placed');
    let ids;
    if (placed?.meals?.length) ids = placed.meals;
    else if (w.id === current || mine.length || w.status === 'ordered') ids = Object.keys(w.picks || {});
    else continue;
    for (const id of ids) {
      out.push({ week: w.id, mealId: id, ordered: !!placed || w.status === 'ordered', delivery: placed?.deliveryDate || w.orderedFor || w.deliveryDate || null, done: w.cooked?.[id] || null });
    }
  }
  return out;
}

// 10 ideas: favourites (most chosen) first, then meals not had for longest,
// skipping anything chosen in the last 2 weeks.
export function pickIdeas(meals, { count = 10, favourites = 4, today = iso(new Date()) } = {}) {
  // Not ones they said they wouldn't make again (unless they changed their mind since).
  const live = meals.filter(m => !m.archived && !wouldNot(m));
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

// "Would you make it again?" after cooking (Recipes). verdicts: [{ again, by, on, note }].
export const lastVerdict = m => (m.verdicts || []).slice(-1)[0] || null;
export const wouldNot = m => lastVerdict(m)?.again === false;

// Ideas Claude (or a recipe site) suggested stay out of the meal library until
// someone picks them. Older docs have no idea flag: an unpicked meal added by
// Claude or a site (addedBy with no uid) counts as an idea.
export function isIdea(m) {
  if (m.idea != null) return m.idea === true && !m.timesChosen;
  return !!m.addedBy && !m.addedBy.uid && !m.timesChosen;
}

// ---------- Scaling recipes ----------
// "Serves 4", "4-6", "Makes 12" → the first number, or null.
export function servesNumber(s) {
  const m = String(s ?? '').match(/\d+/);
  const n = m ? Number(m[0]) : null;
  return n && n <= 30 ? n : null;
}
// How much to scale a meal: the number it's cooked for over what the recipe serves.
export function scaleFor(m, householdServes = 4) {
  const recipe = servesNumber(m.recipe?.servings || m.servings);
  const cook = Number(m.cookFor) || Number(householdServes) || null;
  return recipe && cook ? cook / recipe : 1;
}
const FRACTIONS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
function fmtAmount(n) {
  if (n >= 10) return String(Math.round(n));
  const whole = Math.floor(n), rest = n - whole;
  const near = [[0, ''], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾'], [1, '']].reduce((a, b) => Math.abs(b[0] - rest) < Math.abs(a[0] - rest) ? b : a);
  const w = whole + (near[0] === 1 ? 1 : 0);
  return `${w || !near[1] ? w : ''}${near[1]}` || '0';
}
// Scale the amount at the start of a recipe line: "2 x 400g tins" → "3 x 400g tins",
// "1½ tbsp oil", "200g flour", "2-3 garlic cloves". Only the leading amount
// changes, so pack sizes later in the line ("400g") stay as they are.
export function scaleLine(line, f) {
  if (!f || Math.abs(f - 1) < 0.01) return line;
  const num = '(\\d+\\/\\d+|\\d+(?:[.,]\\d+)?(?:\\s*[¼½¾⅓⅔⅛])?|[¼½¾⅓⅔⅛])';
  const m = String(line).match(new RegExp(`^(\\s*)${num}(?:\\s*[-–]\\s*${num})?`));
  if (!m) return line;
  const val = t => {
    t = t.replace(',', '.').trim();
    if (t.includes('/')) { const [a, b] = t.split('/').map(Number); return b ? a / b : NaN; }
    const fr = t.match(/[¼½¾⅓⅔⅛]/);
    return (parseFloat(t) || 0) + (fr ? FRACTIONS[fr[0]] : 0);
  };
  const a = val(m[2]), b = m[3] ? val(m[3]) : null;
  if (!a || isNaN(a)) return line;
  const rest = line.slice(m[0].length);
  // Weights and spoons can be fractions; counts ("3 eggs", "2 x tins") are whole, or a half.
  const measured = /^\s*(g|kg|ml|l|ltr|litres?|cl|tbsp|tsp|tablespoons?|teaspoons?|cups?|oz|lb|pints?)\b/i.test(rest);
  const round = n => measured ? (n >= 20 ? String(Math.round(n / 5) * 5) : fmtAmount(n)) : n < 0.5 ? '½' : String(Math.round(n));
  return `${m[1]}${round(a * f)}${b ? `–${round(b * f)}` : ''}${rest}`;
}
// Packs to buy for a scaled meal: rounded, never below 1. Small changes (under
// a quarter) are ignored, since a pack usually covers a little more or less.
export function scaleQty(qty = 1, f = 1) {
  if (!f || Math.abs(f - 1) < 0.25) return qty;
  return Math.max(1, Math.round(qty * f));
}

// The week's shop: staples due + ingredients of the chosen meals + shared list items.
// Lines with the same product (or the same search term) are merged.
// qtys: { lineKey: n } quantities changed on the Shop screen. serves: how many the
// household cooks for (meals are scaled from what their recipe serves).
export function buildShop({ staples = [], meals = [], list = [], delivery, extras = {}, qtys = {}, serves = null }) {
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
      put({ key: `staple:${s.id}`, source: 'staple', uid: s.product_uid, name: s.name, qty: s.quantity || 1, status: st, ...(s.keep ? { keep: true } : {}) });
    }
  }
  for (const m of meals) {
    const f = serves ? scaleFor(m, serves) : 1;
    for (const ing of m.ingredients || []) {
      const key = `meal:${m.id}:${ing.item}`;
      // Store-cupboard things (oil, salt, stock...) only when ticked.
      if (extras[key] === false || (ing.pantry && extras[key] !== true)) continue;
      put({ key, source: 'meal', uid: ing.uid || null, search: ing.search || ing.item, name: ing.item, ...(ing.product ? { product: ing.product, usual: true } : {}), qty: scaleQty(ing.qty || 1, f), for: [m.name] });
    }
  }
  for (const it of list) {
    if (it.done) continue;
    put({ key: `list:${it.id}`, source: 'list', uid: it.uid || null, search: it.text, name: it.text, ...(it.product ? { product: it.product } : {}), qty: it.qty || 1, listId: it.id });
  }
  for (const l of lines) if (qtys[l.key] > 0) l.qty = qtys[l.key];
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

// ---------- Cheaper swaps ----------
// Sainsbury's search results already show offer prices in retail_price and
// unit_price, Nectar prices included ("Save 25% with Nectar", "Half price with
// Nectar"); original_unit_price is the price before the offer. Multibuys
// ("Buy 2 for £4.00 with Nectar", "3 for 2") aren't in those prices, so they're
// worked out here, and only count when the line buys enough to get them.

// "Buy any 2 for £5.00 with Nectar" → { n: 2, total: 5 }; "3 for 2" → { n: 3, pay: 2 }.
export function parseMultibuy(strap = '') {
  let m = String(strap).match(/(?:buy\s+)?(?:any\s+)?(\d+)\s+for\s+£\s?(\d+(?:\.\d+)?)/i);
  if (m && Number(m[1]) >= 2) return { n: Number(m[1]), total: Number(m[2]) };
  m = String(strap).match(/(?:buy\s+)?(?:any\s+)?(\d+)\s+for\s+(?:the\s+price\s+of\s+)?(\d+)\b(?!\.)/i);
  if (m && Number(m[1]) > Number(m[2]) && Number(m[2]) >= 1) return { n: Number(m[1]), pay: Number(m[2]) };
  return null;
}

// Price of one item when buying `qty`, after any multibuy it qualifies for.
export function eachPrice(p, qty = 1) {
  const price = Number(p.price);
  const mb = parseMultibuy(p.offer);
  if (!mb || qty < mb.n) return price;
  const deals = Math.floor(qty / mb.n), rest = qty % mb.n;
  const dealTotal = mb.total != null ? mb.total : price * mb.pay;
  return Math.min(price, (deals * dealTotal + rest * price) / qty);
}

// How much is in the pack, in the unit price's measure (kg, ltr, ea...):
// price ÷ unit price (both are after any offer, so the ratio holds).
export function packSize(p) {
  return p.unit && p.price ? Number(p.price) / Number(p.unit) * (Number(p.per) || 1) : null;
}

// Price per kg (or litre, or each) when buying `qty`, multibuys included.
export function unitCost(p, qty = 1) {
  const size = packSize(p);
  return size ? eachPrice(p, qty) / size : null;
}

// Is it on offer at this quantity? Either a price cut (Nectar prices
// included: the unit price is below what it was) or a multibuy the line gets.
export function onOffer(p, qty = 1) {
  if (p.was && p.unit && Number(p.was) > Number(p.unit) + 0.001) return true;
  return eachPrice(p, qty) < Number(p.price) - 0.001;
}

// Words to search for a product we already know by name: drops the store
// brand, range names, pack sizes and counts, so similar products come up too.
export function searchTerms(name = '') {
  return String(name)
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(sainsbury'?s|so organic|taste the difference|by sainsbury'?s|stamford street co\.?|be good to yourself)\b/gi, ' ')
    .replace(/\b\d+\s*[x×]\s*\d+(\.\d+)?\s*(kg|g|ml|l)?\b/gi, ' ')
    .replace(/\b\d+(\.\d+)?\s*(x\s*\d+(\.\d+)?\s*)?(kg|g|ml|l|ltr|cl|pint|pints|pk|pack|ea)\b/gi, ' ')
    .replace(/(^|\s)[x×]\s?\d+\b/gi, ' ')
    .replace(/[,|]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Choose the cheapest acceptable product for a line. `ref` is the product the
// line would otherwise get (the usual, or the search's top match); `others`
// are products judged to be the same thing. Only ones in the same measure and
// a similar pack size (75%–135% of ref) are compared, so the line's quantity
// still means the same amount of food. Only products on offer are swapped to
// (Andrew, 2026-11-07: not just because a basic version is cheaper). A swap needs to save at least 3% and
// 10p across the line. Returns { product, saving } or null to keep ref.
export function cheapestSwap(ref, others, qty = 1) {
  const refCost = unitCost(ref, qty), refSize = packSize(ref);
  if (!refCost || !refSize || ref.catchweight) return null;
  let best = null;
  for (const p of others) {
    if (!p || String(p.uid) === String(ref.uid) || p.available === false || p.catchweight || p.measure !== ref.measure || !onOffer(p, qty)) continue;
    const size = packSize(p), cost = unitCost(p, qty);
    if (!size || !cost || size < refSize * 0.75 || size > refSize * 1.35) continue;
    if (!best || cost < best.cost) best = { p, cost };
  }
  if (!best || best.cost > refCost * 0.97) return null;
  const saving = Math.round((refCost - best.cost) * refSize * qty * 100) / 100;
  return saving >= 0.1 ? { product: best.p, saving } : null;
}
