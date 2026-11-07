// End-to-end check against the Firebase emulators and the pretend shop:
//   firebase emulators:start --only auth,firestore   (in one terminal)
//   python3 -m http.server 8000                       (in another)
//   node test/e2e.mjs
// Two people sign in, share a household, pick meals, add to the list, and
// order; the worker (SAINSBURYS_FAKE=1) drives the order to "placed".
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:8000/?emulator';
const SHOTS = process.env.SHOTS || 'test/shots';
mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error(`FAILED: ${m}`); console.log(`ok - ${m}`); };

async function signIn(page, name, email) {
  // Google's popup can't load in the test sandbox, so use the emulator-only email sign-in.
  await page.fill('form[data-form=testSignIn] input[name=name]', name);
  await page.fill('form[data-form=testSignIn] input[name=email]', email);
  await page.click('text=Test sign in');
  await page.waitForSelector('h1:not(:has-text("Weekly Shop"))', { timeout: 15000 });
}

const browser = await chromium.launch();
// DARK=1 and WIDE=1 re-run the same flow in dark mode or at desktop width, for screenshots.
const phone = { viewport: process.env.WIDE ? { width: 1280, height: 900 } : { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: process.env.DARK ? 'dark' : 'light' };
const a = await (await browser.newContext(phone)).newPage();
const b = await (await browser.newContext(phone)).newPage();
for (const p of [a, b]) { p.on('pageerror', e => console.log('PAGE ERROR', e.message)); p.on('console', m => m.type() === 'error' && console.log('CONSOLE', m.text())); }
a.on('dialog', d => d.accept()); b.on('dialog', d => d.accept());

// Andrew makes the household
await a.goto(BASE);
await a.screenshot({ path: `${SHOTS}/01-signin.png` });
await signIn(a, 'Andrew Wilson', 'andrew@example.com');
assert(await a.isVisible('text=Set up your household'), 'new user sees household setup');
await a.click('text=Create household');
await a.waitForSelector('text=Load starter meals');
await a.click('text=Load starter meals');
await a.waitForSelector('text=Pick from our meals now');
await a.click('text=Pick from our meals now');
await a.waitForSelector('.meal');
assert((await a.$$('.meal')).length === 10, '10 meal ideas offered');

// Invite link → Tessa joins
await a.goto(`${BASE}#/settings`);
const link = await a.inputValue('input[readonly]');
assert(/join=/.test(link), 'invite link shown');
const code = new URL(link).searchParams.get('join');
await b.goto(`${BASE}&join=${code}`);
await signIn(b, 'Tessa Lamb', 'tessa@example.com');
await b.waitForSelector('text=Join “');
await b.screenshot({ path: `${SHOTS}/02-join.png` });
await b.click('button:has-text("Join")');
await b.waitForSelector('.meal');
assert(true, 'Tessa joined and sees the same ideas');

// Picks from both, live
await a.goto(`${BASE}#/week`); await a.waitForSelector('.meal');
await a.locator('.meal').nth(0).click(); await sleep(500);
await a.locator('.meal').nth(1).click(); await sleep(500);
await b.locator('.meal').nth(2).click(); await sleep(800);
await a.waitForSelector('.meal.on >> nth=2');
assert((await a.$$('.meal.on')).length === 3, 'picks from both people show up live');
await a.click('.days button >> nth=1');
await sleep(600);
await a.screenshot({ path: `${SHOTS}/03-week.png`, fullPage: true });
assert(await a.locator('.tabs a').count() === 3 && await a.isVisible('.flow a.now:has-text("Dinners")'), 'three tabs, and the week shows its steps');

// Shared list
await b.goto(`${BASE}#/list`);
await b.fill('input[name=text]', 'Olive oil'); await b.press('input[name=text]', 'Enter');
await b.fill('input[name=text]', 'Something that has nothing'); await b.press('input[name=text]', 'Enter');
await a.goto(`${BASE}#/list`);
await a.waitForSelector('text=Olive oil');
assert(true, 'list item from Tessa appears for Andrew');
await a.screenshot({ path: `${SHOTS}/04-list.png` });

// Staples import
await a.goto(`${BASE}#/settings`);
const seed = process.env.SEED;
if (seed) {
  await a.setInputFiles('input[type=file]', seed);
  await a.waitForSelector('text=Imported');
  await a.goto(`${BASE}#/staples`);
  await a.waitForSelector('.list li');
  assert((await a.$$('.list li')).length > 10, 'staples imported');
  await a.screenshot({ path: `${SHOTS}/05-staples.png`, fullPage: true });
}

// "Your usual": typed list items match products bought before
await a.goto(`${BASE}#/settings`);
await a.setInputFiles('input[type=file]', 'test/fixtures/products.json');
await a.waitForSelector('text=Imported');
await a.goto(`${BASE}#/list`);
await a.fill('input[name=text]', 'shampoo'); await a.press('input[name=text]', 'Enter');
await a.fill('input[name=text]', 'shower gel'); await a.press('input[name=text]', 'Enter');
await a.waitForSelector('text=Your usual: Head & Shoulders');
await a.waitForSelector('text=Your usual: Old Brand Rose Body Wash', { timeout: 5000 });
assert(true, 'shower gel matches a body wash bought before');
assert(await a.isVisible("li:has-text('Olive oil') >> text=Sainsbury's top match"), 'item never bought before is left to the search');
await a.click("li:has-text('shampoo') >> button:has-text('Change')");
await a.waitForSelector('.chooser');
await a.screenshot({ path: `${SHOTS}/04b-usual.png`, fullPage: true });
await a.click('.chooser button:has-text("Aussie")');
await a.waitForSelector('text=Ordering: Aussie Miracle Moist');
assert(true, 'a different past product can be picked');

// Recipe from a link (the worker reads test/fixtures/recipe.html instead of the web)
await b.goto(`${BASE}#/meals`);
await b.fill('input[name=url]', 'https://example.com/recipes/easy-chicken-fajitas');
await b.click('button:has-text("Add recipe")');
await b.waitForSelector('text=Reading the recipe');
const env = { ...process.env, FIRESTORE_EMULATOR_HOST: 'localhost:8081', RECIPE_FAKE: '1' };
await new Promise(r => spawn(process.execPath, ['worker/run.mjs', 'check'], { env, stdio: 'inherit' }).on('exit', r));
await b.waitForSelector('text=11 ingredients added', { timeout: 15000 });
await b.screenshot({ path: `${SHOTS}/05b-import.png`, fullPage: true });
await a.goto(`${BASE}#/week`);
await a.waitForSelector('.meal.on:has-text("Easy chicken fajitas")');
assert(true, 'recipe link became a meal, picked for this week');
await b.click('text=Check it');
await b.waitForSelector('textarea[name=ingredients]');
assert(/Olive oil \(cupboard\)/.test(await b.inputValue('textarea[name=ingredients]')), 'cupboard items marked');
await b.screenshot({ path: `${SHOTS}/05c-imported-meal.png`, fullPage: true });

// Claude ideas (CLAUDE_FAKE gives a canned answer, no API call); picks are kept
await a.goto(`${BASE}#/week`); await a.waitForSelector('.meal');
const picksBefore = (await a.$$('.meal.on')).length;
await a.click('button:has-text("Ask Claude for fresh ideas")');
await a.waitForSelector('text=Claude is thinking');
await new Promise(r => spawn(process.execPath, ['worker/run.mjs', 'check'], { env: { ...env, CLAUDE_FAKE: '1', FEEDS_FAKE: '1' }, stdio: 'inherit' }).on('exit', r));
await a.waitForSelector('text=Pretend new dish', { timeout: 15000 });
assert(await a.isVisible('text=New on The Guardian'), "one idea from the Guardian's recipes this week");
assert(await a.isVisible('text=Pretend theguardian.com recipe'), 'the recipe site idea is shown');
assert(await a.isVisible('text=New from Claude'), 'new dish from Claude added to the ideas');
assert(await a.isVisible('text=Because you liked'), 'Claude reasons shown');
assert((await a.$$('.meal.on')).length === picksBefore, 'picks kept when Claude refreshes ideas');
await a.screenshot({ path: `${SHOTS}/05d-claude-ideas.png`, fullPage: true });

// Settings › Recipe sites: the Guardian by default, with how the last read went; add another
await a.goto(`${BASE}#/settings`);
await a.waitForSelector('text=Recipe sites');
assert(await a.isVisible('text=1 new in the last week'), 'the Guardian is a recipe site by default, and was read');
await a.fill('input[name=url][aria-label="Recipe site address"]', 'bbcgoodfood.com');
await a.fill('input[name=name][aria-label="Name"]', 'BBC Good Food');
await a.click('form[data-form=addSource] button');
await a.waitForSelector('text=BBC Good Food');
await a.screenshot({ path: `${SHOTS}/05e-recipe-sites.png`, fullPage: true });
await a.click('.btn[data-act=delSource][data-id="1"]');
await a.waitForSelector('text=BBC Good Food', { state: 'detached' });

// The shop
await a.goto(`${BASE}#/shop`);
await a.waitForSelector('text=For the meals');
assert(await a.isVisible('text=Black beans'), 'imported recipe ingredients are in the shop');
await a.screenshot({ path: `${SHOTS}/06-shop.png`, fullPage: true });
// Skip all staples, then put them back, then untick one (which the order records as a skip)
await a.click('button:has-text("Skip all staples")');
await a.waitForSelector('button:has-text("Put back")');
assert(await a.isVisible('text=None this week'), 'skip all staples empties the staples section');
await a.click('button:has-text("Put back")');
await a.waitForSelector('button:has-text("Skip all staples")');
await a.click('details[data-toggle=staplesOpen] > summary'); // regulars start folded away
const firstStaple = await a.locator('details[data-toggle=staplesOpen] .name').first().innerText();
await a.locator('details[data-toggle=staplesOpen] input.check').first().click();
await sleep(800);
await a.screenshot({ path: `${SHOTS}/06b-shop-staples.png`, fullPage: true });
await a.click('button:has-text("Send to Sainsbury")');
await a.waitForSelector('text=Starting the order helper');

// Worker with the pretend shop
const worker = spawn(process.execPath, ['worker/run.mjs'], { env: { ...process.env, SAINSBURYS_FAKE: '1', CLAUDE_FAKE: '1', SAINSBURYS_EMAIL: 'x', SAINSBURYS_PASSWORD: 'y', FIRESTORE_EMULATOR_HOST: 'localhost:8081', WORKER_MINUTES: '5' }, stdio: 'inherit' });
const workerDone = new Promise(r => worker.on('exit', r));

await b.goto(`${BASE}#/order`);
await b.waitForSelector('input.code', { timeout: 30000 });
await b.screenshot({ path: `${SHOTS}/07-code.png` });
await b.fill('input.code', '123456'); await b.click('text=Send code');
await a.waitForSelector('.slots button', { timeout: 30000 });
await a.screenshot({ path: `${SHOTS}/08-slots.png`, fullPage: true });
await a.click('.slots button >> nth=0');
await a.waitForSelector('button:has-text("Approve £")', { timeout: 30000 });
await a.screenshot({ path: `${SHOTS}/09-review.png`, fullPage: true });
assert(await a.isVisible('text=not added'), 'unfound item reported');
assert(await a.isVisible('text=organic chicken breast'), 'meal ingredient uses the usual product (organic chicken)');
await a.click('button:has-text("Approve")');
await a.waitForSelector('text=Order placed', { timeout: 30000 });
await a.screenshot({ path: `${SHOTS}/10-placed.png`, fullPage: true });
assert(true, 'order placed');
await workerDone;

await a.goto(`${BASE}#/list`); await sleep(1000);
assert(!(await a.isVisible('text=Olive oil')), 'ordered list items cleared');
assert(!(await a.isVisible('text=shower gel')), 'list item whose usual was gone was ordered via a search');
assert(await a.isVisible('text=Something that has nothing'), 'unfound list item kept');
await a.goto(`${BASE}#/week`); await sleep(800);
assert(await a.isVisible('text=Ordered'), 'week shows as ordered');
await a.screenshot({ path: `${SHOTS}/11-week-after.png`, fullPage: true });
await a.goto(`${BASE}#/staples`); await sleep(800);
assert(await a.isVisible(`li:has-text("${firstStaple.replace(/"/g, '')}") >> text=left out 1× running`), 'unticked staple counted as a skip');
assert(await a.isVisible('summary:has-text("see when")'), 'bought staples log the purchase date');

// Holiday mode
await a.goto(`${BASE}#/settings`);
const d = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
await a.fill('form[data-form=addAway] input[name=from]', d(0));
await a.fill('form[data-form=addAway] input[name=to]', d(10));
await a.click('form[data-form=addAway] button');
await a.waitForSelector('text=Holiday added');
await a.goto(`${BASE}#/week`); await sleep(600);
assert(await a.isVisible('text=Holiday mode'), 'away banner shows');
await a.screenshot({ path: `${SHOTS}/12-holiday.png`, fullPage: true });
await browser.close();
console.log('All good');
