import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mealCategory, autoCategory, mealKind } from '../js/ui.js';

test('starter meals land in sensible categories', () => {
  const { meals } = JSON.parse(readFileSync(new URL('../data/recipes.json', import.meta.url)));
  const got = Object.fromEntries(meals.map(m => [m.name, mealCategory(m)]));
  assert.equal(got['Greek chicken traybake with potatoes, feta and cucumber salad'], 'chicken');
  assert.equal(got['Mild beef and bean chilli with rice and grated cheddar'], 'beef');
  assert.equal(got['Butternut squash and spinach risotto with parmesan'], 'veg');
  assert.equal(got['Sausage, bean and veg casserole with crusty bread'], 'pork');
  assert.equal(got['Turkey meatballs with spaghetti and tomato sauce'], 'chicken');
  assert.equal(got['Lamb kofta flatbreads with tzatziki and salad'], 'lamb');
  assert.equal(got['Garlic king prawn linguine'], 'fish');
});

test('own choice beats Claude\'s protein, which beats the name', () => {
  assert.equal(mealCategory({ name: 'Chicken pie', protein: 'vegetarian' }), 'veg');
  assert.equal(mealCategory({ name: 'Chicken pie', protein: 'vegetarian', category: 'other' }), 'other');
  assert.equal(mealCategory({ name: 'Chicken pie', category: 'nonsense' }), 'chicken');
  assert.equal(mealKind({ name: 'Pork chops' }), 'meat');
});

test('ingredients only fill in meat or fish, never veg or stock', () => {
  assert.equal(autoCategory({ name: 'Roast dinner', ingredients: [{ item: 'Beef joint' }, { item: 'Green beans' }] }), 'beef');
  assert.equal(autoCategory({ name: 'Paella', ingredients: [{ item: 'Chicken stock' }, { item: 'Peas' }] }), 'other');
  assert.equal(autoCategory({ name: 'Pizza night', ingredients: [{ item: 'Green beans' }] }), 'other');
});
