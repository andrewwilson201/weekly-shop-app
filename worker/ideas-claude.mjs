// Claude picks the week's 10 meal ideas, learning from what the household
// actually chose, what they passed over, and the staples they skipped.
// New dishes come back with ingredient lists and are added to the library.
// Needs ANTHROPIC_API_KEY; without it (or on any failure) the caller falls
// back to the rule-based pickIdeas in js/plan.js.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

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
        required: ['existing_id', 'name', 'reason', 'tags', 'ingredients'],
        properties: {
          existing_id: { type: 'string', description: 'id of a meal from the library, or "" for a new dish' },
          name: { type: 'string' },
          reason: { type: 'string', description: 'One short sentence for the family on why this is suggested this week' },
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

Learn from their history: suggest dishes like the ones they pick, and fewer like the ones they keep passing over. Offer the household's favourites regularly, but don't repeat anything they had in the last two weeks, and keep a good variety of proteins and styles across the 10. Include 3 or 4 new dishes they haven't had, chosen to suit what they evidently like. For every new dish, list the ingredients to buy for that dinner for the whole household, as Sainsbury's shop items. Mark store-cupboard basics as pantry.

Respect any notes about the household (ages, dislikes, allergies, how adventurous they are). Write each reason as one short, friendly sentence addressed to the family.`;

export async function claudeIdeas({ meals, weeks, skippedStaples = [], notes = '', season = '' }) {
  if (process.env.CLAUDE_FAKE) return fakeIdeas(meals); // tests: no API call
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

  const prompt = [
    `Household notes: ${notes || 'none given'}`,
    `Time of year: ${season}`,
    `Meal library (JSON):\n${JSON.stringify(library)}`,
    `Recent weeks, newest first (JSON):\n${JSON.stringify(history)}`,
    skippedStaples.length ? `Regular items they've been leaving out of the shop lately: ${skippedStaples.join(', ')}` : '',
    'Give exactly 10 ideas. Use existing_id for library meals (with an empty ingredients list), and "" for new dishes.',
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
  return validate(ideas, byId);
}

// Keep only usable ideas: real library ids, or new dishes with ingredients. No duplicates.
export function validate(ideas, byId) {
  const out = []; const seen = new Set();
  for (const i of ideas || []) {
    if (i.existing_id && byId.has(i.existing_id)) {
      if (seen.has(i.existing_id)) continue;
      seen.add(i.existing_id); out.push({ id: i.existing_id, reason: i.reason });
    } else if (!i.existing_id && i.name && i.ingredients?.length) {
      const dup = [...byId.values()].find(m => m.name.toLowerCase() === i.name.toLowerCase());
      if (dup) { if (!seen.has(dup.id)) { seen.add(dup.id); out.push({ id: dup.id, reason: i.reason }); } continue; }
      out.push({ meal: { name: i.name, tags: i.tags || [], ingredients: i.ingredients.map(g => ({ item: g.item, qty: Math.max(1, g.qty || 1), search: g.search || g.item, ...(g.pantry ? { pantry: true } : {}) })) }, reason: i.reason });
    }
    if (out.length === 10) break;
  }
  return out;
}

function fakeIdeas(meals) {
  const byId = new Map(meals.map(m => [m.id, m]));
  const ideas = meals.slice(0, 8).map(m => ({ existing_id: m.id, name: m.name, reason: `Because you liked ${m.name.split(' ')[0].toLowerCase()} dishes`, tags: [], ingredients: [] }));
  ideas.push({ existing_id: '', name: 'Pretend new dish: lemon chicken orzo', reason: 'Something new, like your traybakes', tags: ['chicken'],
    ingredients: [{ item: 'Orzo', qty: 1, search: 'sainsburys orzo', pantry: false }, { item: 'Chicken thighs', qty: 1, search: 'sainsburys chicken thighs', pantry: false }, { item: 'Olive oil', qty: 1, search: 'olive oil', pantry: true }] });
  return validate(ideas, byId);
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
