// Claude picks the week's 10 meal ideas, learning from what the household
// actually chose, what they passed over, and the staples they skipped.
// New dishes come back with ingredient lists and are added to the library.
// Needs ANTHROPIC_API_KEY; without it (or on any failure) the caller falls
// back to the rule-based pickIdeas in js/plan.js.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

export const PROTEINS = ['chicken', 'beef', 'pork', 'lamb', 'turkey', 'fish', 'seafood', 'vegetarian', 'vegan'];
// At most this many of the 10 share a main protein (vegetarian dishes count together with vegan).
export const MAX_PER_PROTEIN = 2;

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
        required: ['existing_id', 'recipe_url', 'name', 'reason', 'protein', 'cuisine', 'tags', 'ingredients'],
        properties: {
          existing_id: { type: 'string', description: 'id of a meal from the library, or "" for a new dish' },
          recipe_url: { type: 'string', description: 'For a recipe from the "New on their recipe sites" list: its url, exactly as given. Otherwise ""' },
          name: { type: 'string' },
          reason: { type: 'string', description: 'One short sentence for the family on why this is suggested this week' },
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

Learn from their history: suggest dishes like the ones they pick, and fewer like the ones they keep passing over. Offer a few of the household's favourites, but don't repeat anything they had in the last two weeks.

Variety matters as much as taste. These rules are firm:
- No more than ${MAX_PER_PROTEIN} of the 10 share a main protein (chicken, beef, pork, lamb, turkey, fish, seafood, vegetarian or vegan; vegetarian and vegan count together).
- At least 1 fish or seafood dinner and at least 2 vegetarian or vegan dinners.
- At least 5 different cuisines, and no more than 3 pasta, rice or noodle dishes between them.
- Mix the style: traybakes, one-pot, stir-fries, grills, bakes, soups or salads, wraps or tacos, and at least 3 quick ones (under 30 minutes).
- 4 or 5 dishes they haven't had, chosen to suit what they evidently like but stretching them a little. Don't offer a variation of something already in the 10 or in their library.
- Avoid anything offered in the last 3 weeks unless it's a clear favourite.

For every new dish, list the ingredients to buy for that dinner for the whole household, as Sainsbury's shop items. Mark store-cupboard basics as pantry.

When the message lists recipes newly published on the family's chosen recipe sites, include exactly one from each site (the one that best suits this family) as a new dish, with recipe_url set to its url and the name as published. These count towards the new dishes and the variety rules; list their ingredients as for any new dish.

Respect any notes about the household (ages, dislikes, allergies, how adventurous they are). Write each reason as one short, friendly sentence addressed to the family.`;

// featured: recipes newly published on the household's recipe sites
// ([{ source, title, url, published, summary }]); one per site is asked for.
export async function claudeIdeas({ meals, weeks, skippedStaples = [], notes = '', season = '', featured = [] }) {
  if (process.env.CLAUDE_FAKE) return fakeIdeas(meals, featured); // tests: no API call
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const byId = new Map(meals.map(m => [m.id, m]));
  const library = meals.filter(m => !m.archived).map(m => ({
    id: m.id, name: m.name, tags: m.tags || [], times_picked: m.timesChosen || 0, last_picked: m.lastChosen || null,
  }));
  const history = weeks.map(w => ({
    week: w.id,
    picked: Object.keys(w.picks || {}).map(id => byId.get(id)?.name).filter(Boolean),
    passed_over: (w.offered || []).filter(id => !(w.picks || {})[id]).map(id => byId.get(id)?.name).filter(Boolean),
  })).filter(w => w.picked.length || w.passed_over.length);
  const offeredRecently = [...new Set(weeks.slice(0, 3).flatMap(w => w.offered || []).map(id => byId.get(id)?.name).filter(Boolean))];

  const prompt = [
    `Household notes: ${notes || 'none given'}`,
    `Time of year: ${season}`,
    `Meal library (JSON):\n${JSON.stringify(library)}`,
    `Recent weeks, newest first (JSON):\n${JSON.stringify(history)}`,
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
      if (seen.has(i.existing_id)) continue;
      seen.add(i.existing_id); out.push({ id: i.existing_id, reason: i.reason });
    } else if (!i.existing_id && i.name && i.ingredients?.length) {
      const dup = [...byId.values()].find(m => m.name.toLowerCase() === i.name.toLowerCase());
      if (dup) { if (!seen.has(dup.id)) { seen.add(dup.id); out.push({ id: dup.id, reason: i.reason }); } }
      else {
        const f = feedUrls.get(i.recipe_url);
        // A recipe from a site already in the library (an earlier week) is offered again rather than added twice.
        const known = f && [...byId.values()].find(m => m.source === f.url);
        if (known) { if (!seen.has(known.id)) { seen.add(known.id); out.push({ id: known.id, reason: i.reason, from: f.source }); } }
        else out.push({ ...(f ? { from: f.source } : {}), meal: { name: i.name, ...(f ? { source: f.url } : {}), tags: i.tags || [], ...(i.cuisine ? { cuisine: i.cuisine } : {}), ...(i.protein ? { protein: i.protein } : {}), ingredients: i.ingredients.map(g => ({ item: g.item, qty: Math.max(1, g.qty || 1), search: g.search || g.item, ...(g.pantry ? { pantry: true } : {}) })) }, reason: i.reason });
      }
    }
    if (p && out.length > before) { perProtein[p] = (perProtein[p] || 0) + 1; out[out.length - 1].protein = p; }
    if (out.length === 10) break;
  }
  return out;
}

function fakeIdeas(meals, featured = []) {
  const byId = new Map(meals.map(m => [m.id, m]));
  const ideas = meals.slice(0, 8).map(m => ({ existing_id: m.id, name: m.name, reason: `Because you liked ${m.name.split(' ')[0].toLowerCase()} dishes`, tags: [], ingredients: [] }));
  ideas.push({ existing_id: '', name: 'Pretend new dish: lemon chicken orzo', reason: 'Something new, like your traybakes', tags: ['chicken'],
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

export async function claudeIngredients(meals, notes = '') {
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
    messages: [{ role: 'user', content: `Household notes: ${notes || 'none given'}\n\nDinners (JSON):\n${JSON.stringify(meals)}\n\nReturn an ingredients list for every id.` }],
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
