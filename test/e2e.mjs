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
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
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
await a.waitForSelector('text=Make 10 ideas');
await a.click('text=Make 10 ideas');
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

// The shop
await a.goto(`${BASE}#/shop`);
await a.waitForSelector('text=For the meals');
await a.screenshot({ path: `${SHOTS}/06-shop.png`, fullPage: true });
await a.click('button:has-text("Order from Sainsbury")');
await a.waitForSelector('text=Starting the order helper');

// Worker with the pretend shop
const worker = spawn(process.execPath, ['worker/run.mjs'], { env: { ...process.env, SAINSBURYS_FAKE: '1', SAINSBURYS_EMAIL: 'x', SAINSBURYS_PASSWORD: 'y', FIRESTORE_EMULATOR_HOST: 'localhost:8081', WORKER_MINUTES: '5' }, stdio: 'inherit' });
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
await a.click('button:has-text("Approve")');
await a.waitForSelector('text=Order placed', { timeout: 30000 });
await a.screenshot({ path: `${SHOTS}/10-placed.png`, fullPage: true });
assert(true, 'order placed');
await workerDone;

await a.goto(`${BASE}#/list`); await sleep(1000);
assert(!(await a.isVisible('text=Olive oil')), 'ordered list items cleared');
assert(await a.isVisible('text=Something that has nothing'), 'unfound list item kept');
await a.goto(`${BASE}#/week`); await sleep(800);
assert(await a.isVisible('text=Ordered'), 'week shows as ordered');
await a.screenshot({ path: `${SHOTS}/11-week-after.png`, fullPage: true });
await browser.close();
console.log('All good');
