// Small UI helpers shared by the screens: icons, meal tiles, avatars.

const P = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  thumbUp: '<path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.5 10H18a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7"/>',
  thumbDown: '<path d="M17 13V4h3v9zM17 13l-4 7c-1.5 0-2.5-1-2.2-2.6l.7-3.4H6a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 7.2 4H17"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
  truck: '<path d="M3 6.5h11v9H3zM14 9.5h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  cart: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20.5" r="1.2"/><circle cx="17" cy="20.5" r="1.2"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14a6.5 6.5 0 0 1 3 6"/>',
  plane: '<path d="M10.5 13.5 3 11l1.5-2 7 1 4.5-5c1-1 2.8-1.3 3.3-.8s.2 2.3-.8 3.3l-5 4.5 1 7-2 1.5-2.5-7.5-4 3.5v2.5l-1.5 1-1-3.5-3.5-1 1-1.5h2.5z"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
  box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  layers: '<path d="M12 3 3 7.5 12 12l9-4.5L12 3zM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  // meal tiles
  leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19c3-4 6-6.5 10-8.5"/>',
  fish: '<path d="M3 12c3-4.5 7-6 11-6 3.5 0 6 3 7 6-1 3-3.5 6-7 6-4 0-8-1.5-11-6z"/><path d="M3 12c-1 2-1 4 0 5 1-2 1-3 0-5zM3 12c-1-2-1-4 0-5 1 2 1 3 0 5"/><circle cx="16.5" cy="11" r=".8"/>',
  drumstick: '<path d="M15.5 4.5a5 5 0 0 1 4 6.9 5 5 0 0 1-6.6 2.6L9.5 17.4a2 2 0 1 1-2.6 2.6 2 2 0 1 1-2.9-2.9 2 2 0 1 1 2.6-2.6l3.4-3.4a5 5 0 0 1 5.5-6.6z"/>',
  meat: '<path d="M7 5c5-3 13 1 13 7 0 4-3 7-8 7-6 0-9-3-9-6 0-2 1.5-3 3-3.5C5 8 5 6.5 7 5z"/><circle cx="14" cy="12" r="2"/>',
  pasta: '<path d="M3.5 12h17a8.5 8.5 0 0 1-17 0z"/><path d="M9 12c-2-1-2-3 0-4s4 0 3 2-4 1-3-1M15 4l-3 8M19 5l-6 7"/>',
  pot: '<path d="M4.5 10h15v6a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4z"/><path d="M2.5 10h19M9.5 6.5c0-1 1-1.5 1-2.5M14 6.5c0-1 1-1.5 1-2.5"/>',
  pie: '<path d="M3 13h18l-2 6H5z"/><path d="M3 13c1-4 5-6 9-6s8 2 9 6"/><path d="M8 10.5l1 1.5M12 9.5V12M16 10.5l-1 1.5"/>',
  pizza: '<path d="M12 21 3.5 6.5a14 14 0 0 1 17 0z"/><path d="M5.3 9.5a11 11 0 0 1 13.4 0"/><circle cx="12" cy="13" r="1"/><circle cx="9.8" cy="11" r=".8"/><circle cx="14" cy="10.5" r=".8"/>',
  tray: '<rect x="2.5" y="9" width="19" height="9" rx="2"/><path d="M7 13.5c1-1.5 2-1.5 3 0M13 12.5h4M2.5 11.5H1M23 11.5h-1.5"/>',
  bowl: '<path d="M3.5 11h17a8.5 8.5 0 0 1-17 0z"/><path d="M8 7.5c0-1.5 1-2 1-3.5M12 7.5c0-1.5 1-2 1-3.5M16 7.5c0-1.5 1-2 1-3.5"/>',
};
export const icon = (name, cls = '') => `<svg viewBox="0 0 24 24"${cls ? ` class="${cls}"` : ''} aria-hidden="true">${P[name] || ''}</svg>`;

// Which tile a meal gets: from Claude's protein label, else a guess from the name.
export function mealKind(m) {
  const p = (m.protein || '').toLowerCase();
  const n = (m.name || '').toLowerCase();
  if (['chicken', 'turkey'].includes(p) || (!p && /chicken|turkey|duck/.test(n))) return 'poultry';
  if (['fish', 'seafood'].includes(p) || (!p && /salmon|fish|cod|tuna|prawn|haddock|mackerel|trout|seafood|shrimp/.test(n))) return 'fish';
  if (['beef', 'pork', 'lamb'].includes(p) || (!p && /beef|lamb|pork|sausage|pancetta|bacon|chorizo|mince|ham|steak|kofta|meatball|burger/.test(n))) return 'meat';
  if (['vegetarian', 'vegan'].includes(p) || (!p && /veg|bean|lentil|halloumi|tofu|paneer|squash|spinach|mushroom|cauliflower|chickpea|risotto|margherita|cheese/.test(n))) return 'veg';
  return 'other';
}

// Meal categories for the Meals list, like the chapters of a family cookbook:
// by kind of dish first, in this order, so "chicken pasta bake" is Pasta and
// "fish pie" is Pies & bakes. A meal that's none of these (say, salmon with
// rice) goes in a chapter for its main ingredient. Each is [key, title, tile
// icon, tile colour, pattern for the name and tags].
export const MEAL_CATEGORIES = [
  ['pasta', 'Pasta', 'pasta', 'poultry', /pasta|spaghetti|linguine|tagliatelle|fettuccine|penne|rigatoni|fusilli|farfalle|orzo|macaroni|mac ?(and|&|n) ?cheese|lasagne|lasagna|cannelloni|ravioli|tortellini|gnocchi|carbonara|bolognese|puttanesca|arrabbiata/],
  ['noodles', 'Noodles & stir-fries', 'bowl', 'other', /noodle|ramen|udon|soba|pad thai|chow mein|lo mein|stir[- ]?fry|stir[- ]?fried/],
  ['curry', 'Curries', 'pot', 'meat', /curry|curries|tikka|masala|korma|jalfrezi|balti|madras|rogan josh|vindaloo|dhal|\bdal\b|daal|biryani|massaman|rendang|saag/],
  ['pie', 'Pies & bakes', 'pie', 'poultry', /\bpies?\b|pasties|pasty|\bbakes?\b|\bbaked\b|gratin|moussaka|enchilada|crumble|wellington|quiche|frittata|toad in the hole|hotpot/],
  ['stew', 'Stews, soups & chillies', 'pot', 'meat', /stew|casserole|chilli|chili|tagine|goulash|soup|chowder|broth|ragout|cassoulet|bourguignon|stroganoff/],
  ['rice', 'Rice & risotto', 'bowl', 'veg', /risotto|paella|fried rice|pilaf|pilau|jambalaya|kedgeree|congee|rice bowl|burrito bowl|poke/],
  ['fakeaway', 'Pizzas, wraps & burgers', 'pizza', 'fish', /pizza|calzone|wrap|fajita|taco|burrito|quesadilla|nacho|burger|flatbread|kofta|pitta|pita|kebab|gyros|souvlaki|hot ?dog|sandwich|toastie|\bsub\b|\bbao\b/],
  ['roast', 'Roasts, grills & traybakes', 'tray', 'veg', /roast|traybake|tray bake|sheet ?pan|one[- ]pan|one[- ]tray|bbq|barbecue|grill/],
  ['salad', 'Salads', 'leaf', 'veg', /^(?!.*\bwith\b.*\bsalad).*salad/],
  ['meat', 'Meat & poultry', 'meat', 'meat', null],
  ['fish', 'Fish & seafood', 'fish', 'fish', null],
  ['veg', 'Vegetarian', 'leaf', 'veg', null],
  ['other', 'Everything else', 'bowl', 'other', null],
];
const CAT_KEYS = new Set(MEAL_CATEGORIES.map(c => c[0]));
const dishType = text => (MEAL_CATEGORIES.find(([, , , , re]) => re && re.test(text)) || [])[0];
// The category worked out without the meal's own choice: used for "Automatic".
export function autoCategory(m) {
  const tags = (m.tags || []).map(t => String(t).toLowerCase());
  const main = (m.ingredients || []).filter(i => !i.pantry).map(i => String(i.item || '').toLowerCase());
  const byDish = dishType((m.name || '').toLowerCase()) || tags.map(dishType).find(Boolean)
    // The pasta or noodles in the bag say what it is, e.g. "Meatballs in tomato sauce" with spaghetti.
    || main.map(dishType).find(k => k === 'pasta' || k === 'noodles');
  if (byDish) return byDish;
  return { poultry: 'meat', meat: 'meat', fish: 'fish', veg: 'veg' }[mealKind(m)] || 'other';
}
export const mealCategory = m => (CAT_KEYS.has(m.category) ? m.category : autoCategory(m));
export const categoryTile = (key, size = '') => { const c = MEAL_CATEGORIES.find(x => x[0] === key); return `<span class="tile ${c[3]}${size ? ` ${size}` : ''}">${icon(c[2])}</span>`; };
const KIND_ICON = { poultry: 'drumstick', fish: 'fish', meat: 'meat', veg: 'leaf', other: 'bowl' };
export const tile = (m, size = '') => `<span class="tile ${mealKind(m)}${size ? ` ${size}` : ''}">${icon(KIND_ICON[mealKind(m)])}</span>`;

export const initials = name => String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase().replace(/[^A-Z0-9]/g, '') || '?';
// A stable colour per person.
export const avatar = (person, size = '') => {
  const key = String(person?.uid || person?.name || '');
  let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="avatar c${(h % 4) + 1}${size ? ` ${size}` : ''}" title="${String(person?.name || '').replace(/["&<>]/g, '')}">${initials(person?.name)}</span>`;
};
