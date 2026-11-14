// Claude picks the week's 10 meal ideas, learning from what the household
// actually chose, what they passed over, and the staples they skipped.
// New dishes come back with ingredient lists and are added to the library.
// Needs ANTHROPIC_API_KEY; without it (or on any failure) the caller falls
// back to the rule-based pickIdeas in js/plan.js.

import Anthropic from '@anthropic-ai/sdk';
import { wouldNot } from '../js/plan.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

export const PROTEINS = ['chicken', 'beef', 'pork', 'lamb', 'turkey', 'fish', 'seafood', 'vegetarian', 'vegan'];
// At most this many of the 10 share a main protein (vegetarian dishes count together with vegan).
export const MAX_PER_PROTEIN = 2;

// What's in season in the UK each month (UK-grown veg and fruit, plus the
// game and fish at their best), and the weather it brings. Shown to Claude
// so new dishes lean on cheap, good produce and suit the time of year.
export const SEASONAL = {
  January: { mood: 'winter', produce: 'leeks, parsnips, swede, celeriac, kale, cavolo nero, savoy and red cabbage, Brussels sprouts, cauliflower, Jerusalem artichokes, forced rhubarb, apples, pears, mussels' },
  February: { mood: 'winter', produce: 'leeks, parsnips, swede, celeriac, kale, savoy cabbage, purple sprouting broccoli, cauliflower, Jerusalem artichokes, forced rhubarb, apples, mussels' },
  March: { mood: 'early spring', produce: 'purple sprouting broccoli, spring greens, leeks, cauliflower, spinach, wild garlic, spring onions, forced rhubarb, cabbage' },
  April: { mood: 'spring', produce: 'asparagus (from late April), purple sprouting broccoli, spring greens, spinach, wild garlic, radishes, spring onions, watercress, rhubarb, Jersey Royal potatoes' },
  May: { mood: 'late spring', produce: 'asparagus, Jersey Royal and new potatoes, spinach, radishes, spring onions, lettuce, watercress, broad beans, peas (late May), rhubarb, crab' },
  June: { mood: 'summer', produce: 'asparagus (early June), new potatoes, peas, broad beans, courgettes, lettuce, radishes, cucumber, spinach, strawberries, cherries, gooseberries, mackerel, crab' },
  July: { mood: 'summer', produce: 'courgettes, runner and French beans, peas, broad beans, new potatoes, tomatoes, cucumber, lettuce, beetroot, fennel, sweetcorn (late July), strawberries, raspberries, cherries, mackerel' },
  August: { mood: 'late summer', produce: 'tomatoes, sweetcorn, courgettes, aubergines, peppers, runner and French beans, beetroot, fennel, cucumber, lettuce, plums, blackberries, raspberries, mackerel' },
  September: { mood: 'early autumn', produce: 'tomatoes, sweetcorn, peppers, aubergines, courgettes, squash (from late September), beetroot, leeks, kale, cauliflower, apples, pears, plums, blackberries, mussels' },
  October: { mood: 'autumn', produce: 'butternut and other squash, pumpkin, leeks, parsnips, carrots, beetroot, kale, celeriac, cabbage, cauliflower, wild mushrooms, apples, pears, mussels' },
  November: { mood: 'late autumn', produce: 'squash, pumpkin, leeks, parsnips, swede, celeriac, kale, cavolo nero, Brussels sprouts, red and savoy cabbage, cauliflower, Jerusalem artichokes, apples, pears, cranberries, mussels' },
  December: { mood: 'winter', produce: 'Brussels sprouts, parsnips, swede, leeks, celeriac, kale, red and savoy cabbage, cauliflower, Jerusalem artichokes, chestnuts, apples, pears, cranberries, mussels' },
};

// "Time of year" lines for the ideas message. month is a full English month name.
export function seasonNote(month) {
  const s = SEASONAL[month];
  if (!s) return `Time of year: ${month || 'unknown'}, UK`;
  return `Time of year: ${month} in the UK (${s.mood})\nIn season in the UK now: ${s.produce}`;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ideas'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['existing_id', 'recipe_url', 'name', 'reason', 'time', 'protein', 'cuisine', 'tags', 'ingredients'],
        properties: {
          existing_id: { type: 'string', description: 'id of a meal from the library, or "" for a new dish' },
          recipe_url: { type: 'string', description: 'For a recipe from the "New on their recipe sites" list: its url, exactly as given. Otherwise ""' },
          name: { type: 'string' },
          reason: { type: 'string', description: 'One short sentence for the family on why this is suggested this week' },
          time: { type: 'string', description: 'About how long it takes to make, start to finish, e.g. "25 min" or "1 hr 15 min"' },
          protein: { type: 'string', enum: PROTEINS, description: 'The main protein' },
          cuisine: { type: 'string', description: 'e.g. Italian, Indian, Mexican, British, Chinese, Thai, Middle Eastern, Greek, Japanese, Spanish' },
          tags: { type: 'array', items: { type: 'string' } },
          ingredients: {
            type: 'array',
            description: 'Only for new dishes (empty for library meals). Shop items for a family of four.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['item', 'qty', 'search', 'pantry'],
              properties: {
                item: { type: 'string', description: 'Short shop name, e.g. "Chopped tomatoes"' },
                qty: { type: 'integer', description: 'Packs to buy, usually 1' },
                search: { type: 'string', description: "Sainsbury's search words, e.g. \"sainsburys chopped tomatoes 400g\"" },
                pantry: { type: 'boolean', description: 'true for store-cupboard basics (oil, salt, spices, stock) most kitchens have' },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You plan the weekly dinners for a family's online Sainsbury's shop. Each week you offer 10 dinner ideas; the family picks about 5.

Learn from their history: suggest dishes like the ones they pick, and fewer like the ones they keep passing over. After cooking a dinner they say whether they'd make it again (after_cooking in the library): never offer a dish whose latest answer is "would NOT make again", treat their notes (for example "too spicy for the kids") as guidance for new dishes, and favour dishes they'd make again. Offer a few of the household's favourites, but don't repeat anything they had in the last two weeks.

Variety matters as much as taste. These rules are firm:
- No more than ${MAX_PER_PROTEIN} of the 10 share a main protein (chicken, beef, pork, lamb, turkey, fish, seafood, vegetarian or vegan; vegetarian and vegan count together).
- At least 1 fish or seafood dinner and at least 2 vegetarian or vegan dinners.
- At least 5 different cuisines, and no more than 3 pasta, rice or noodle dishes between them.
- Mix the style: traybakes, one-pot, stir-fries, grills, bakes, soups or salads, wraps or tacos, and at least 3 quick ones (under 30 minutes).
- 4 or 5 dishes they haven't had, chosen to suit what they evidently like but stretching them a little. Don't offer a variation of something already in the 10 or in their library.
- Avoid anything offered in the last 3 weeks unless it's a clear favourite.

Cook with the season (the message gives the month and what's in season in the UK):
- Build new dishes around the produce that's in season now, and when choosing library meals favour ones that use it. Seasonal veg is cheaper and tastes better.
- Let the weather lead the mix: in the colder months lean towards warming food (stews, casseroles, soups, pies, roasts, curries, bakes); in the warmer months lean towards lighter food (salads, grills and barbecue, wraps, quick stir-fries, cold noodles).
- Lean, don't exclude. Most of the 10 should suit the season, but always keep 1 or 2 that go against it, such as a hearty warm salad or grain bowl in winter, or a light stew, curry or soup in summer. Never drop salads entirely in winter or stews entirely in summer.
- Library favourites can be offered at any time of year; just don't let out-of-season dishes take over.

Use up what gets bought. A recipe that needs half a pot of soured cream, a bunch of coriander, a bag of spinach or half a tin of coconut milk leaves the rest to go off. Where you can, pair dishes so a fresh ingredient bought for one is used up by another among the 10 (for example fajitas and a curry that both use coriander and soured cream or yoghurt), and say so in the reason ("uses the rest of the coriander from the fajitas"). Don't force it at the cost of variety.

Give each idea a realistic total time (prep and cooking) so the family can pick quick ones for busy nights.

For every new dish, list the ingredients to buy for that dinner for the whole household, as Sainsbury's shop items. Mark store-cupboard basics as pantry.

When the message lists recipes newly published on the family's chosen recipe sites, include exactly one from each site (the one that best suits this family and the season) as a new dish, with recipe_url set to its url and the name as published. These count towards the new dishes and the variety rules; list their ingredients as for any new dish.

Respect any notes about the household (ages, dislikes, allergies, how adventurous they are). Write each reason as one short, friendly sentence addressed to the family.`;

// featured: recipes newly published on the household's recipe sites
// ([{ source, title, url, published, summary }]); one per site is asked for.
export async function claudeIdeas({ meals, weeks, skippedStaples = [], notes = '', month = '', featured = [] }) {
  if (process.env.CLAUDE_FAKE) return fakeIdeas(meals, featured); // tests: no API call
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const byId = new Map(meals.map(m => [m.id, m]));
  const library = meals.filter(m => !m.archived).map(m => ({
    id: m.id, name: m.name, tags: m.tags || [], times_picked: m.timesChosen || 0, last_picked: m.lastChosen || null,
    // "Would you make it again?" answers after cooking, newest last.
    ...((m.verdicts || []).length ? { after_cooking: m.verdicts.slice(-3).map(v => `${v.again ? 'would make again' : 'would NOT make again'}${v.note ? `: ${v.note}` : ''}`) } : {}),
  }));
  const history = weeks.map(w => ({
    week: w.id,
    picked: Object.keys(w.picks || {}).map(id => byId.get(id)?.name).filter(Boolean),
    passed_over: (w.offered || []).filter(id => !(w.picks || {})[id]).map(id => byId.get(id)?.name).filter(Boolean),
  })).filter(w => w.picked.length || w.passed_over.length);
  const offeredRecently = [...new Set(weeks.slice(0, 3).flatMap(w => w.offered || []).map(id => byId.get(id)?.name).filter(Boolean))];

  const prompt = [
    `Household notes: ${notes || 'none given'}`,
    seasonNote(month),
    `Meal library (JSON):\n${JSON.stringify(library)}`,
    `Recent shops, newest first (JSON):\n${JSON.stringify(history)}`,
    offeredRecently.length ? `Offered in the last 3 weeks: ${offeredRecently.join('; ')}` : '',
    featured.length ? `New on their recipe sites in the last week (JSON):\n${JSON.stringify(featured.map(f => ({ site: f.source, title: f.title, url: f.url, published: f.published?.slice(0, 10), summary: f.summary })))}` : '',
    skippedStaples.length ? `Regular items they've been leaving out of the shop lately: ${skippedStaples.join(', ')}` : '',
    'Give exactly 10 ideas, following the variety rules. Use existing_id for library meals (with an empty ingredients list), and "" for new dishes.',
  ].filter(Boolean).join('\n\n');

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // if a safety check declines, the API retries on a suitable model
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw new Error(`Claude stopped: ${response.stop_reason}`);
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const ideas = JSON.parse(text).ideas;
  return validate(ideas, byId, featured);
}

// Keep only usable ideas: real library ids, or new dishes with ingredients. No duplicates.
export function validate(ideas, byId, featured = []) {
  const feedUrls = new Map(featured.map(f => [f.url, f]));
  const out = []; const seen = new Set(); const perProtein = {};
  for (const i of ideas || []) {
    // Enforce the protein rule here too, in case the answer breaks it; the caller tops up.
    const p = i.protein === 'vegan' ? 'vegetarian' : i.protein;
    // The recipe-site picks always stay: they're the point of that setting.
    if (p && !feedUrls.has(i.recipe_url) && (perProtein[p] || 0) >= MAX_PER_PROTEIN + (p === 'vegetarian' ? 1 : 0)) continue;
    const before = out.length;
    if (i.existing_id && byId.has(i.existing_id)) {
      // Never a dinner they said they wouldn't make again.
      if (seen.has(i.existing_id) || wouldNot(byId.get(i.existing_id))) continue;
      seen.add(i.existing_id); out.push({ id: i.existing_id, reason: i.reason, ...(i.time ? { time: i.time } : {}) });
    } else if (!i.existing_id && i.name && i.ingredients?.length) {
      const dup = [...byId.values()].find(m => m.name.toLowerCase() === i.name.toLowerCase());
      if (dup) { if (!seen.has(dup.id) && !wouldNot(dup)) { seen.add(dup.id); out.push({ id: dup.id, reason: i.reason, ...(i.time ? { time: i.time } : {}) }); } }
      else {
        const f = feedUrls.get(i.recipe_url);
        // A recipe from a site already in the library (an earlier week) is offered again rather than added twice.
        const known = f && [...byId.values()].find(m => m.source === f.url);
        if (known) { if (!seen.has(known.id)) { seen.add(known.id); out.push({ id: known.id, reason: i.reason, from: f.source }); } }
        else out.push({ ...(f ? { from: f.source } : {}), meal: { name: i.name, ...(f ? { source: f.url } : {}), ...(i.time ? { time: i.time } : {}), tags: i.tags || [], ...(i.cuisine ? { cuisine: i.cuisine } : {}), ...(i.protein ? { protein: i.protein } : {}), ingredients: i.ingredients.map(g => ({ item: g.item, qty: Math.max(1, g.qty || 1), search: g.search || g.item, ...(g.pantry ? { pantry: true } : {}) })) }, reason: i.reason });
      }
    }
    if (p && out.length > before) { perProtein[p] = (perProtein[p] || 0) + 1; out[out.length - 1].protein = p; }
    if (out.length === 10) break;
  }
  return out;
}

function fakeIdeas(meals, featured = []) {
  const byId = new Map(meals.map(m => [m.id, m]));
  const ideas = meals.slice(0, 8).map((m, i) => ({ existing_id: m.id, name: m.name, reason: `Because you liked ${m.name.split(' ')[0].toLowerCase()} dishes`, time: `${25 + 5 * i} min`, tags: [], ingredients: [] }));
  ideas.push({ existing_id: '', name: 'Pretend new dish: lemon chicken orzo', reason: 'Something new, like your traybakes', time: '35 min', tags: ['chicken'],
    ingredients: [{ item: 'Orzo', qty: 1, search: 'sainsburys orzo', pantry: false }, { item: 'Chicken thighs', qty: 1, search: 'sainsburys chicken thighs', pantry: false }, { item: 'Olive oil', qty: 1, search: 'olive oil', pantry: true }] });
  for (const f of [...new Map(featured.map(f => [f.source, f])).values()]) ideas.unshift({ existing_id: '', recipe_url: f.url, name: f.title, reason: `New on ${f.source} this week`, protein: 'vegetarian', tags: [],
    ingredients: [{ item: 'Butternut squash', qty: 1, search: 'sainsburys butternut squash', pantry: false }] });
  return validate(ideas, byId, featured);
}

// Shop ingredient lists for meals that have none, e.g. meals from the order
// history or typed in by name. Returns { mealId: [ingredients] }, or null with no key.
const ING_ITEM = SCHEMA.properties.ideas.items.properties.ingredients.items;
const ING_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['meals'],
  properties: { meals: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'ingredients'],
    properties: { id: { type: 'string' }, ingredients: { type: 'array', items: ING_ITEM } } } } },
};

export async function claudeIngredients(meals, notes = '', serves = null) {
  if (!meals.length) return {};
  if (process.env.CLAUDE_FAKE) return Object.fromEntries(meals.map(m => [m.id, [{ item: `Pretend ingredient for ${m.name}`, qty: 1, search: 'sainsburys pasta' }]]));
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const response = await new Anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ING_SCHEMA } },
    system: `You write shopping lists for a family's online Sainsbury's shop. For each dinner, list what to buy to cook it once for the whole household, as Sainsbury's shop items. Include every component in the dish's name (sides too). Mark store-cupboard basics (oil, salt, pepper, dried spices, stock cubes, flour) as pantry. Respect any household notes.`,
    messages: [{ role: 'user', content: `${serves ? `The household cooks for ${serves}.\n` : ''}Household notes: ${notes || 'none given'}\n\nDinners (JSON):\n${JSON.stringify(meals)}\n\nReturn an ingredients list for every id.` }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw new Error(`Claude stopped: ${response.stop_reason}`);
  const out = JSON.parse(response.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  const ids = new Set(meals.map(m => m.id));
  return Object.fromEntries((out.meals || []).filter(m => ids.has(m.id)).map(m => [m.id,
    (m.ingredients || []).filter(g => g.item).map(g => ({ item: g.item, qty: Math.max(1, g.qty || 1), search: g.search || g.item, ...(g.pantry ? { pantry: true } : {}) }))]));
}

// "Your usual" for meal ingredients: for each ingredient, pick the product the
// household normally buys from its past purchases (free range or organic, the
// brand they stick to), or none when nothing fits (then the shop's search
// picks). asks is [{ key, item, candidates: [{ u, n, c, l }] }]. Returns
// { key: uid }, or null with no key.
const USUAL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['picks'],
  properties: { picks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'uid'],
    properties: { key: { type: 'string' }, uid: { type: 'string', description: 'uid of the chosen past product, or "" if none of them is this ingredient' } } } } },
};
export async function claudeUsual(asks) {
  if (!asks.length) return {};
  if (process.env.CLAUDE_FAKE) return Object.fromEntries(asks.map(a => [a.key, a.candidates[0].u]));
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const response = await new Anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: USUAL_SCHEMA } },
    system: `You help fill a family's Sainsbury's basket. Each ingredient comes from a recipe, with products the family has bought before (c = times bought, l = last bought). Pick the product that IS that ingredient and that the family usually buys: keep to their usual quality, origin and brand (for example free range or organic meat if that's what they buy), favouring what they buy often and recently. The product must be the ingredient itself, not something that only contains it: for "garlic" not garlic cream cheese, for "onions" not spring onions or pickled onions, for "parmesan" not a pasta dish. Pack size should suit one family meal. If none of them is the ingredient, return "".`,
    messages: [{ role: 'user', content: `Ingredients (JSON):\n${JSON.stringify(asks)}\n\nReturn a pick for every key.` }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw new Error(`Claude stopped: ${response.stop_reason}`);
  const out = JSON.parse(response.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  const ok = new Map(asks.map(a => [a.key, new Set(a.candidates.map(c => String(c.u)))]));
  return Object.fromEntries((out.picks || []).filter(p => p.uid && ok.get(p.key)?.has(String(p.uid))).map(p => [p.key, String(p.uid)]));
}

// Cheaper swaps: for each basket line, which of the shop's search results are
// the same thing as the product it would get (the family's usual, or the
// search's top match when there's no usual). Claude only judges "same thing";
// the prices are compared in code (js/plan.js cheapestSwap), so it isn't shown
// them. Returns { key: [uid, ...] }.
const SWAP_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['lines'],
  properties: { lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'same'],
    properties: { key: { type: 'string' }, same: { type: 'array', items: { type: 'string' }, description: 'uids of the options that would do just as well as the current product' } } } } },
};
export async function claudeSwaps(asks, notes = '') {
  if (!asks.length) return {};
  if (process.env.CLAUDE_FAKE) return Object.fromEntries(asks.map(a => [a.key, a.options.filter(o => /cheaper/i.test(o.n)).map(o => o.u)]));
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const response = await new Anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SWAP_SCHEMA } },
    system: `You help a family save money on their Sainsbury's shop without them noticing a worse product. The options are all on offer this week. Each line has the product it would get ("current": their usual, or the top search match) and other options from the shop. List the options that would do just as well, so the cheapest of those can be bought instead.

An option counts only if it is the same kind of product, for the same use, and keeps every quality the current one has: organic stays organic, free range stays free range, higher welfare, outdoor bred, Fairtrade, British, MSC stay; same cut and form (breast fillets not thighs or mini fillets, a block not slices or grated, fresh not frozen or long life, whole not diced); same fat level, flavour, variety and dietary type (lactose free, gluten free, wholewheat). Pack size doesn't matter here (it's checked separately).

Brand: switching between Sainsbury's own label and a well known brand is fine for basic foods where the brand makes little difference (tinned tomatoes, pasta, rice, flour, sugar, plain cheese, milk, frozen veg, bin bags, foil). Keep the brand when it is the point of the product or the family clearly sticks with it (Lurpak, Heinz beans, branded cereals and snacks the children have, toiletries, cleaning products, nappies, coffee, wine). Taste the Difference stays Taste the Difference or an equally premium brand. Never go to a budget range (Stamford Street, Hubbard's, KTC style value lines) from a standard or premium product, unless the current product is already a budget one.

The household's own notes come first: anything they say to always buy, or never swap, wins. If in doubt, leave an option out. It is fine to return an empty list.`,
    messages: [{ role: 'user', content: `${notes ? `Household notes:\n${notes}\n\n` : ''}Lines (JSON):\n${JSON.stringify(asks)}\n\nReturn every key.` }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw new Error(`Claude stopped: ${response.stop_reason}`);
  const out = JSON.parse(response.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  const ok = new Map(asks.map(a => [a.key, new Set(a.options.map(o => String(o.u)))]));
  return Object.fromEntries((out.lines || []).filter(l => ok.has(l.key)).map(l => [l.key, (l.same || []).map(String).filter(u => ok.get(l.key).has(u))]));
}

// A stand-in for a product that won't go in the basket (out of stock for the
// slot, or discontinued): which of the shop's search results is the same
// thing. Returns a uid, "" when none of them will do, or null without a key.
const STANDIN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['uid'],
  properties: { uid: { type: 'string', description: 'u of the option that is the same thing, or "" if none is' } },
};
export async function claudeStandIn(ask, notes = '') {
  if (!ask.options?.length) return '';
  if (process.env.CLAUDE_FAKE) return ask.options[0].u;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const response = await new Anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: STANDIN_SCHEMA } },
    system: `You help fill a family's Sainsbury's basket. The product they usually buy ("current") can't be added this time, so pick the option from the shop's search results that is the closest stand-in. It must be the same kind of product for the same use and keep every quality the current one has: organic stays organic, free range stays free range, higher welfare, British, MSC stay; same cut and form (breast fillets not thighs, fresh not frozen or long life); same fat level, flavour and dietary type (semi skimmed stays semi skimmed, lactose free stays lactose free). A similar pack size is best (two smaller packs are not an option here, so pick the nearest size). Keep the brand where it matters. The household's own notes come first. If none of the options will do, return "".`,
    messages: [{ role: 'user', content: `${notes ? `Household notes:\n${notes}\n\n` : ''}Item (JSON):\n${JSON.stringify(ask)}` }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw new Error(`Claude stopped: ${response.stop_reason}`);
  const out = JSON.parse(response.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  const uid = String(out.uid || '');
  return ask.options.some(o => o.u === uid) ? uid : '';
}

// A recipe to cook from, for a meal whose page has no method (or that has no
// page: Claude's own dishes, starter meals, ones typed in by name). Written for
// the household, using what the shop buys for it. Returns null with no key.
const RECIPE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['servings', 'time', 'lines', 'steps'],
  properties: {
    servings: { type: 'string', description: 'e.g. "Serves 4 (2 adults, 2 children)"' },
    time: { type: 'string', description: 'Total time, e.g. "40 min" or "1 hr 15 min"' },
    lines: { type: 'array', items: { type: 'string' }, description: 'Ingredients with amounts, e.g. "2 x 400g tins chopped tomatoes"' },
    steps: { type: 'array', items: { type: 'string' }, description: 'Method, one step per item, in order' },
  },
};
export async function claudeRecipe(meal, notes = '') {
  if (process.env.CLAUDE_FAKE) return { servings: 'Serves 4', time: '30 min', lines: (meal.ingredients || []).map(i => i.item), steps: [`Pretend step one for ${meal.name}.`, 'Pretend step two.'], by: 'claude' };
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const response = await new Anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: RECIPE_SCHEMA } },
    system: `You write clear home recipes for a UK family's weeknight dinners. Write one recipe for the dinner named, for the whole household, using the shopping list given (store-cupboard basics are fine to add). Use UK names and metric amounts, oven temperatures in °C (fan), and say how to tell when things are done. Keep it to 4 to 10 short steps that are easy to follow on a phone while cooking. Respect any household notes (ages, dislikes, allergies).`,
    messages: [{ role: 'user', content: `Household notes: ${notes || 'none given'}\n\nDinner: ${meal.name}\nShopping list: ${(meal.ingredients || []).map(i => `${i.item}${i.qty > 1 ? ` x${i.qty}` : ''}`).join(', ') || 'none given'}` }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw new Error(`Claude stopped: ${response.stop_reason}`);
  const r = JSON.parse(response.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  const clean = a => (a || []).map(x => String(x).trim()).filter(Boolean);
  if (!clean(r.steps).length) return null;
  return { servings: String(r.servings || ''), time: String(r.time || ''), lines: clean(r.lines), steps: clean(r.steps), by: 'claude' };
}
