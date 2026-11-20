import test from 'node:test';
import assert from 'node:assert/strict';
import { ideaMix, mixFor, roundRobin, IDEA_MIX } from '../js/plan.js';
import { validate, systemPrompt } from '../worker/ideas-claude.mjs';

test('idea mix: defaults, limits, and the total is the sum', () => {
  assert.deepEqual(ideaMix({}), { ...IDEA_MIX, total: 10 });
  assert.deepEqual(ideaMix({ ideaMix: { sites: 5, fresh: 0, favourites: 2 } }), { sites: 5, fresh: 0, favourites: 2, total: 7 });
  assert.equal(ideaMix({ ideaMix: { sites: 99, fresh: -3, favourites: 4 } }).sites, 10);
  assert.equal(ideaMix({ ideaMix: { sites: 99, fresh: -3, favourites: 4 } }).fresh, 0);
  // Over 15 in all: favourites trimmed first.
  assert.deepEqual(ideaMix({ ideaMix: { sites: 8, fresh: 6, favourites: 6 } }), { sites: 8, fresh: 6, favourites: 1, total: 15 });
  // Never none at all.
  assert.equal(ideaMix({ ideaMix: { sites: 0, fresh: 0, favourites: 0 } }).total, 1);
});

test('site slots the sites cannot fill go to new ideas', () => {
  const mix = ideaMix({ ideaMix: { sites: 4, fresh: 2, favourites: 4 } });
  assert.deepEqual(mixFor(mix, 10), mix);
  assert.deepEqual(mixFor(mix, 1), { ...mix, sites: 1, fresh: 5 });
  assert.deepEqual(mixFor(mix, 0), { ...mix, sites: 0, fresh: 6 });
});

test('site recipes are taken from each site in turn, newest first', () => {
  const r = (source, day) => ({ source, published: `2026-11-${day}`, url: `${source}${day}` });
  const out = roundRobin([r('A', 10), r('A', 18), r('A', 15), r('B', 12), r('C', 17), r('C', 11)]);
  assert.deepEqual(out.map(x => x.url), ['A18', 'C17', 'B12', 'A15', 'C11', 'A10']);
});

test('validate keeps to the mix and labels each idea', () => {
  const byId = new Map(['a', 'b', 'c'].map(id => [id, { id, name: id }]));
  const featured = ['1', '2', '3'].map(n => ({ source: `S${n}`, url: `https://s${n}.example/r`, title: `R${n}` }));
  const ing = [{ item: 'x', qty: 1 }];
  const ideas = [
    { existing_id: 'a' }, { existing_id: 'b' }, { existing_id: 'c' },
    { existing_id: '', name: 'New 1', ingredients: ing }, { existing_id: '', name: 'New 2', ingredients: ing },
    ...featured.map(f => ({ existing_id: '', recipe_url: f.url, name: f.title, ingredients: ing })),
  ];
  const out = validate(ideas, byId, featured, { sites: 2, fresh: 1, favourites: 2, total: 5 });
  assert.deepEqual(out.map(o => o.kind), ['favourites', 'favourites', 'fresh', 'sites', 'sites']);
  // Without a mix: up to 10, as before.
  assert.equal(validate(ideas, byId, featured).length, 8);
});

test('the prompt asks for the numbers set', () => {
  const p = systemPrompt({ sites: 3, fresh: 3, favourites: 4, total: 10 });
  assert.match(p, /Exactly 4 from their meal library/);
  assert.match(p, /Exactly 3 new dishes/);
  assert.match(p, /Exactly 3 from the recipes newly published/);
  assert.match(p, /one from each site before a second/);
  assert.match(p, /always keep 1 or 2 that go against it/);
  const none = systemPrompt({ sites: 0, fresh: 6, favourites: 0, total: 6 });
  assert.doesNotMatch(none, /recipe sites/);
  assert.match(none, /No more than 2 of the 6/);
  assert.match(systemPrompt({ sites: 5, fresh: 5, favourites: 5, total: 15 }), /No more than 3 of the 15/);
});
