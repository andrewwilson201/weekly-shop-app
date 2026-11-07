// node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, feedLink, isFeed, recentRecipes, recipeSources, DEFAULT_SOURCES } from '../worker/feeds.mjs';
import { validate } from '../worker/ideas-claude.mjs';

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Recipes | The Guardian</title>
<item><title>Meera Sodha’s vegan recipe for squash dal</title><link>https://www.theguardian.com/food/2026/nov/06/squash-dal-recipe</link>
<description>&lt;p&gt;A mild, warming dal&lt;/p&gt;</description><pubDate>Fri, 06 Nov 2026 12:00:00 GMT</pubDate><dc:date>2026-11-06T12:00:00Z</dc:date></item>
<item><title><![CDATA[Old fish pie]]></title><link>https://www.theguardian.com/food/2026/oct/01/fish-pie</link><pubDate>Thu, 01 Oct 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Tray-baked gnocchi</title><link rel="alternate" href="https://example.com/gnocchi"/><published>2026-11-05T08:00:00Z</published><summary>Easy</summary></entry></feed>`;

test('reads RSS and Atom feeds', () => {
  assert.ok(isFeed(RSS) && isFeed(ATOM) && !isFeed('<html><body>hi</body></html>'));
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Meera Sodha’s vegan recipe for squash dal');
  assert.equal(items[0].url, 'https://www.theguardian.com/food/2026/nov/06/squash-dal-recipe');
  assert.equal(items[0].published, '2026-11-06T12:00:00.000Z');
  assert.equal(items[0].summary, 'A mild, warming dal');
  assert.equal(items[1].title, 'Old fish pie');
  assert.deepEqual(parseFeed(ATOM).map(i => [i.title, i.url, i.published]), [['Tray-baked gnocchi', 'https://example.com/gnocchi', '2026-11-05T08:00:00.000Z']]);
});

test('finds a feed link on a page', () => {
  const html = '<head><link rel="stylesheet" href="/a.css"><link rel="alternate" type="application/rss+xml" title="Recipes" href="/recipes/feed"></head>';
  assert.equal(feedLink(html, 'https://example.com/recipes'), 'https://example.com/recipes/feed');
  assert.equal(feedLink('<html></html>', 'https://example.com'), null);
});

test('keeps the last 7 days per site, and reports sites that fail', async () => {
  const read = async url => { if (url.includes('broken')) throw new Error('the site said 403'); return { feed: url, items: parseFeed(RSS) }; };
  const { recipes, status } = await recentRecipes([{ name: 'The Guardian', url: 'https://g.example/rss' }, { name: 'Broken', url: 'https://broken.example' }], { now: new Date('2026-11-07T10:00:00Z'), read });
  assert.deepEqual(recipes.map(r => [r.source, r.title]), [['The Guardian', 'Meera Sodha’s vegan recipe for squash dal']]);
  assert.deepEqual(status.map(s => [s.ok, s.note]).sort(), [[false, 'the site said 403'], [true, '1 new in the last week']]);
});

test('the Guardian is the default; an empty list means none', () => {
  assert.deepEqual(recipeSources({}), DEFAULT_SOURCES);
  assert.deepEqual(recipeSources({ recipeSources: [] }), []);
});

test('a site recipe from Claude keeps its link and survives the protein rule', () => {
  const meals = [{ id: 'a', name: 'Chicken A' }, { id: 'b', name: 'Chicken B' }];
  const featured = [{ source: 'The Guardian', url: 'https://g.example/chicken', title: 'Chicken C' }];
  const ing = [{ item: 'Chicken', qty: 1, search: 'chicken', pantry: false }];
  const out = validate([
    { existing_id: 'a', protein: 'chicken' }, { existing_id: 'b', protein: 'chicken' },
    { existing_id: '', recipe_url: 'https://g.example/chicken', name: 'Chicken C', protein: 'chicken', ingredients: ing, reason: 'r' },
    { existing_id: '', recipe_url: 'https://made.up/x', name: 'Chicken D', protein: 'chicken', ingredients: ing },
  ], new Map(meals.map(m => [m.id, m])), featured);
  assert.equal(out.length, 3);
  assert.equal(out[2].from, 'The Guardian');
  assert.equal(out[2].meal.source, 'https://g.example/chicken');
});
