// Recipe links → meals. Most recipe sites put a schema.org Recipe in the page
// (JSON-LD, or microdata as a fallback) with a recipeIngredient list. That
// list is turned into shop lines: "2 x 400g tins chopped tomatoes" becomes
// { item: 'Chopped tomatoes', qty: 2, search: 'sainsburys chopped tomatoes' }.
// Store-cupboard basics (salt, oil, stock...) are kept but marked pantry, so
// the shop leaves them out unless ticked.

const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const UNITS = String.raw`(?:kg|g|grams?|mg|ml|millilitres?|l|litres?|liters?|cl|oz|ounces?|lbs?|pounds?|tbsps?|tablespoons?|tbs|tsps?|teaspoons?|dsp|cups?|pints?|pinch(?:es)?|dash(?:es)?|handfuls?|bunch(?:es)?|sprigs?|sticks?|slices?|knobs?|thumb-sized pieces?|pieces?|pcs|cloves?|heads?|cans?|tins?|jars?|packs?|packets?|pots?|tubs?|bags?|sachets?|cartons?|bottles?|fillets?|rashers?|sheets?|balls?|drizzle|splash|squeeze|few|rounded|heaped|level|large|medium|small|big|generous|good)`;
const PANTRY = /^(sea |table |flaky |rock |kosher )?salt\b|black pepper|white pepper|^pepper$|salt and (black )?pepper|^(extra[- ]virgin |light |mild )?olive oil|vegetable oil|sunflower oil|rapeseed oil|cooking oil|groundnut oil|^oil\b|^water\b|boiling water|cold water|^ice\b|^(caster |granulated |golden caster )?sugar$|^plain flour$|^self[- ]raising flour$|^cornflour$|stock cubes?|stock pots?|^stock$|^bay leaf|^bay leaves|cooking spray|^vinegar$|ground cumin|ground coriander|paprika|chilli flakes|dried oregano|dried thyme|dried mixed herbs|garam masala|ground cinnamon|bicarbonate|baking powder|^honey$|soy sauce|worcestershire sauce|tomato pur[eé]e/i;

const decode = s => String(s ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#x27;/g, "'").replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&frac12;/g, '½').replace(/&frac14;/g, '¼').replace(/&frac34;/g, '¾').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function num(s) {
  if (!s) return null;
  s = s.trim();
  if (FRACTIONS[s]) return FRACTIONS[s];
  const m = s.match(/^(\d+)?\s*([½¼¾⅓⅔⅛])$/); if (m) return (+m[1] || 0) + FRACTIONS[m[2]];
  const f = s.match(/^(\d+)\/(\d+)$/); if (f) return +f[1] / +f[2];
  const n = parseFloat(s); return isNaN(n) ? null : n;
}

export function parseIngredient(line) {
  const original = decode(line);
  let s = original.toLowerCase()
    .replace(/\([^)]*\)/g, ' ')                 // (about 500g)
    .replace(/\b(optional|to serve|to taste|for (frying|serving|the [a-z ]+)|plus (extra|more)[^,]*)\b/g, ' ')
    .replace(/^[-•*\s]+/, '');
  s = s.split(/,|;| - | – /)[0];               // drop prep notes: ", finely chopped"
  s = s.replace(/\bfreshly\s+/g, '').replace(/^\s*(a|an|some)\s+/, '');
  let qty = 1;
  const Q = String.raw`(\d+(?:[.,]\d+)?(?:\s*[½¼¾⅓⅔⅛])?|[½¼¾⅓⅔⅛]|\d+\/\d+)`;
  // "2 x 400g tins ..." or "2 tins ..." → 2 of the pack
  let m = s.match(new RegExp(String.raw`^\s*${Q}\s*(?:x|×)\s*`));
  if (m) { qty = Math.max(1, Math.round(num(m[1]))); s = s.slice(m[0].length); }
  // leading amount and units, repeatedly: "1 heaped tbsp", "400g can", "1-2 tsp"
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(new RegExp(String.raw`^\s*${Q}(?:\s*(?:-|–|to)\s*${Q})?\s*`), (all, a) => {
      const n = num(a);
      if (n && /^\s*(cans?|tins?|jars?|packs?|packets?|pots?|tubs?|bags?|cartons?|bottles?)\b/.test(s.slice(all.length)) && n >= 1) qty = Math.round(n);
      return '';
    });
    s = s.replace(new RegExp(String.raw`^\s*${UNITS}\b\.?\s*`), '').replace(/^\s*(of|x)\s+/, '');
    if (s === before) break;
  }
  s = s.replace(/\s+/g, ' ').replace(/^(a|an|some|fresh)\s+/, '').trim();
  if (!s) s = original.toLowerCase();
  const item = s.charAt(0).toUpperCase() + s.slice(1);
  return { item, qty, search: `sainsburys ${s}`, pantry: PANTRY.test(s), line: original };
}

// ---- finding the Recipe in a page ----
function walk(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, out)); return; }
  const type = [].concat(node['@type'] || []).map(String);
  if (type.some(t => /(^|\/)Recipe$/i.test(t))) out.push(node);
  if (node['@graph']) walk(node['@graph'], out);
  if (node.mainEntity) walk(node.mainEntity, out);
}

export function extractRecipe(html, url = '') {
  const recipes = [];
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim()), recipes); } catch { /* some sites put invalid JSON here */ }
  }
  let name, ingredients = [], image, servings;
  const r = recipes.find(x => x.recipeIngredient || x.ingredients) || recipes[0];
  if (r) {
    name = decode(r.name || r.headline || '');
    ingredients = [].concat(r.recipeIngredient || r.ingredients || []).map(decode).filter(Boolean);
    const img = [].concat(r.image || [])[0];
    image = typeof img === 'string' ? img : img?.url;
    servings = decode([].concat(r.recipeYield || [])[0] || '');
  }
  if (!ingredients.length) {
    // Microdata fallback: itemprop="recipeIngredient" / "ingredients"
    ingredients = [...html.matchAll(/itemprop=["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\/(?:li|span|p|div)>/gi)].map(m => decode(m[1])).filter(Boolean);
  }
  if (!name) {
    // Page titles usually end with the site's name: "Fish pie | BBC Good Food"
    const t = decode((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || html.match(/<title>([^<]+)/i) || [])[1] || url);
    name = t.replace(/\s+[|–-]\s+[^|–-]+$/, '').trim() || t;
  }
  return { name, ingredients, image, servings };
}

export async function fetchRecipe(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-GB,en;q=0.9' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`The site said ${res.status}.`);
  const html = await res.text();
  const r = extractRecipe(html, url);
  if (!r.ingredients.length) throw new Error('Couldn\'t find an ingredient list on that page.');
  // One shop line per distinct item
  const seen = new Map();
  for (const ing of r.ingredients.map(parseIngredient)) {
    const k = ing.item.toLowerCase();
    if (seen.has(k)) seen.get(k).qty += ing.qty > 1 ? ing.qty : 0; else seen.set(k, ing);
  }
  return { ...r, ingredients: [...seen.values()] };
}
