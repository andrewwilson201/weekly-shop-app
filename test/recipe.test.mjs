// node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractRecipe, parseIngredient } from '../worker/recipe.mjs';

test('finds a Recipe inside @graph JSON-LD', () => {
  const r = extractRecipe(readFileSync(new URL('./fixtures/recipe.html', import.meta.url), 'utf8'));
  assert.equal(r.name, 'Easy chicken fajitas');
  assert.equal(r.ingredients.length, 11);
  assert.equal(r.image, 'https://example.com/fajitas.jpg');
});

test('microdata fallback and title clean-up', () => {
  const html = '<title>Pea soup | Some Site</title><ul><li itemprop="recipeIngredient">500g frozen peas</li><li itemprop="recipeIngredient">1 onion</li></ul>';
  const r = extractRecipe(html);
  assert.equal(r.name, 'Pea soup');
  assert.deepEqual(r.ingredients, ['500g frozen peas', '1 onion']);
});

test('ingredient lines become shop items', () => {
  const cases = [
    ['2 x 400g tins chopped tomatoes', 'Chopped tomatoes', 2, false],
    ['400g can chopped tomatoes', 'Chopped tomatoes', 1, false],
    ['1 large onion, finely chopped', 'Onion', 1, false],
    ['500g beef mince (5% fat)', 'Beef mince', 1, false],
    ['a handful of basil leaves', 'Basil leaves', 1, false],
    ['2 tins of cannellini beans, drained', 'Cannellini beans', 2, false],
    ['½ tsp chilli flakes', 'Chilli flakes', 1, true],
    ['2 tbsp olive oil', 'Olive oil', 1, true],
    ['1 chicken stock cube', 'Chicken stock cube', 1, true],
    ['Salt and freshly ground black pepper', 'Salt and ground black pepper', 1, true],
  ];
  for (const [line, item, qty, pantry] of cases) {
    const r = parseIngredient(line);
    assert.equal(r.item, item, line); assert.equal(r.qty, qty, line); assert.equal(r.pantry, pantry, line);
    assert.equal(r.search, `sainsburys ${item.toLowerCase()}`);
  }
});
