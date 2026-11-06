// Small UI helpers shared by the screens: icons, meal tiles, avatars.

const P = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
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
  // meal tiles
  leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19c3-4 6-6.5 10-8.5"/>',
  fish: '<path d="M3 12c3-4.5 7-6 11-6 3.5 0 6 3 7 6-1 3-3.5 6-7 6-4 0-8-1.5-11-6z"/><path d="M3 12c-1 2-1 4 0 5 1-2 1-3 0-5zM3 12c-1-2-1-4 0-5 1 2 1 3 0 5"/><circle cx="16.5" cy="11" r=".8"/>',
  drumstick: '<path d="M15.5 4.5a5 5 0 0 1 4 6.9 5 5 0 0 1-6.6 2.6L9.5 17.4a2 2 0 1 1-2.6 2.6 2 2 0 1 1-2.9-2.9 2 2 0 1 1 2.6-2.6l3.4-3.4a5 5 0 0 1 5.5-6.6z"/>',
  meat: '<path d="M7 5c5-3 13 1 13 7 0 4-3 7-8 7-6 0-9-3-9-6 0-2 1.5-3 3-3.5C5 8 5 6.5 7 5z"/><circle cx="14" cy="12" r="2"/>',
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
const KIND_ICON = { poultry: 'drumstick', fish: 'fish', meat: 'meat', veg: 'leaf', other: 'bowl' };
export const tile = (m, size = '') => `<span class="tile ${mealKind(m)}${size ? ` ${size}` : ''}">${icon(KIND_ICON[mealKind(m)])}</span>`;

export const initials = name => String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase().replace(/[^A-Z0-9]/g, '') || '?';
// A stable colour per person.
export const avatar = (person, size = '') => {
  const key = String(person?.uid || person?.name || '');
  let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="avatar c${(h % 4) + 1}${size ? ` ${size}` : ''}" title="${String(person?.name || '').replace(/["&<>]/g, '')}">${initials(person?.name)}</span>`;
};
