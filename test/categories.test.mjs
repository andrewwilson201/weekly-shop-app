import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mealCategory, autoCategory } from '../js/ui.js';

test('starter meals land in cookbook-style chapters', () => {
  const { meals } = JSON.parse(readFileSync(new URL('../data/recipes.json', import.meta.url)));
  const got = Object.fromEntries(meals.map(m => [m.name, mealCategory(m)]));
  assert.deepEqual(got, {
    'Greek chicken traybake with potatoes, feta and cucumber salad': 'roast',
    'Mild beef and bean chilli with rice and grated cheddar': 'stew',
    'Teriyaki chicken noodle stir-fry with sugar snaps and carrots': 'noodles',
    'Butternut squash and spinach risotto with parmesan': 'rice',
    'Sausage, bean and veg casserole with crusty bread': 'stew',
    'Honey and soy salmon with sticky rice and broccoli': 'fish',
    'Chicken fajita wraps with peppers, soured cream and salsa': 'fakeaway',
    'Turkey meatballs with spaghetti and tomato sauce': 'pasta',
    'Homemade pizza night': 'fakeaway',
    'Baked rigatoni with tomato and mozzarella, green salad': 'pasta',
    'Pancetta carbonara with linguine': 'pasta',
    'Chicken tikka masala with sticky rice': 'curry',
    'Fish pie with a cheesy mash top and peas': 'pie',
    'Lamb kofta flatbreads with tzatziki and salad': 'fakeaway',
    'Chicken, leek and mushroom pie': 'pie',
    'Garlic king prawn linguine': 'pasta',
  });
});

test('dish type beats main ingredient; own choice beats both', () => {
  assert.equal(mealCategory({ name: 'Chicken pasta bake' }), 'pasta');
  assert.equal(mealCategory({ name: 'Chicken biryani' }), 'curry');
  assert.equal(mealCategory({ name: 'Pork chops with mash', protein: 'pork' }), 'meat');
  assert.equal(mealCategory({ name: 'Halloumi and roasted veg couscous', protein: 'vegetarian' }), 'roast');
  assert.equal(mealCategory({ name: 'Couscous with feta', protein: 'vegetarian' }), 'veg');
  assert.equal(mealCategory({ name: 'Chicken pie', category: 'meat' }), 'meat');
  assert.equal(mealCategory({ name: 'Chicken pie', category: 'nonsense' }), 'pie');
});

test('tags and pasta in the ingredients help when the name says nothing', () => {
  assert.equal(autoCategory({ name: 'Mum\'s Tuesday special', tags: ['kids', 'curry'] }), 'curry');
  assert.equal(autoCategory({ name: 'Meatballs in tomato sauce', ingredients: [{ item: 'Spaghetti' }, { item: 'Beef meatballs' }] }), 'pasta');
  assert.equal(autoCategory({ name: 'Garden supper', ingredients: [{ item: 'Green salad' }] }), 'other');
  assert.equal(autoCategory({ name: 'Leek and potato soup with a salad' }), 'stew');
  assert.equal(autoCategory({ name: 'Warm chicken Caesar salad' }), 'salad');
});
