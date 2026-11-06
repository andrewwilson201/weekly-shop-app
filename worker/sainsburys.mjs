// Sainsbury's groceries, driven through a real (headed) Chromium window.
// Login needs the browser; everything after it goes through the site's own
// JSON API, called from inside the page so it carries the same cookies and
// passes the same bot checks as the website. Run under xvfb-run on a server.
//
// Findings (Nov 2026): headless Chromium is blocked ("Access Denied"), headed
// is not. Login asks for an SMS code every time. Slots, booking and basket
// all work through /groceries-api/gol-services. Checkout needs £25 of items
// (excluding delivery) and is placed with the "Place order" button on
// /gol-ui/checkout/summary, which uses the saved card.

import { chromium } from 'playwright';

const SITE = 'https://www.sainsburys.co.uk';
const API = `${SITE}/groceries-api/gol-services`;

export class Sainsburys {
  constructor({ store = '0031', log = console.log } = {}) {
    this.store = store;
    this.log = log;
  }

  async open() {
    this.browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
    this.ctx = await this.browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'en-GB', timezoneId: 'Europe/London' });
    this.page = await this.ctx.newPage();
  }
  async close() { await this.browser?.close().catch(() => {}); }

  async dismissCookies() {
    const p = this.page;
    await p.click('#onetrust-accept-btn-handler', { timeout: 4000 }).catch(() => {});
    await p.evaluate(() => { document.querySelector('.onetrust-pc-dark-filter')?.remove(); document.querySelector('#onetrust-consent-sdk')?.remove(); }).catch(() => {});
  }

  // getCode: async () => '123456' (resolves when someone types the SMS code into the app)
  async login(email, password, getCode) {
    const p = this.page;
    this.log('Opening the login page');
    await p.goto(`${SITE}/gol-ui/oauth/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (/Access Denied/i.test(await p.title())) throw new Error('Sainsbury\'s blocked this computer (Access Denied) at login.');
    await this.dismissCookies();
    await p.waitForSelector('input[type="email"], input[name="email"], #username', { timeout: 60000 });
    await p.fill('input[type="email"], input[name="email"], #username', email);
    await p.fill('input[type="password"], input[name="password"], #password', password);
    await this.dismissCookies();
    await p.click('button[type="submit"], button[data-testid="log-in"]');
    await p.waitForURL(u => /\/mfa|sainsburys\.co\.uk\/gol-ui/.test(String(u)) && !/login\?/.test(String(u)), { timeout: 45000 }).catch(() => {});
    if (p.url().includes('/mfa')) {
      this.log('SMS code needed');
      const code = await getCode();
      await p.fill('#code, input[name="code"]', code);
      await this.dismissCookies();
      await p.click('button[data-testid="submit-code"], button[type="submit"]:has-text("Continue")');
      await p.waitForURL(u => String(u).startsWith(SITE) , { timeout: 45000 }).catch(() => {});
      if (/login|mfa/.test(p.url())) throw new Error('Sainsbury\'s didn\'t accept that code.');
    } else if (/login/.test(p.url())) {
      throw new Error('Sainsbury\'s didn\'t accept the email and password.');
    }
    await p.waitForTimeout(3000);
    this.log('Logged in');
  }

  async token() {
    const c = (await this.ctx.cookies(SITE)).find(x => x.name.startsWith('WC_AUTHENTICATION_'));
    return c ? c.value : '';
  }

  async api(method, path, { params, body, override } = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    const token = await this.token();
    const res = await this.page.evaluate(async ({ url, method, body, token, override }) => {
      const headers = { accept: 'application/json', 'content-type': 'application/json', wcauthtoken: token };
      if (override) headers['x-http-method-override'] = override;
      const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'include' });
      const text = await r.text();
      return { status: r.status, text };
    }, { url: url.toString(), method, body, token, override });
    let data = null; try { data = res.text ? JSON.parse(res.text) : null; } catch { data = res.text; }
    if (res.status >= 400) { const e = new Error(`${method} ${path} → ${res.status}`); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  // Product search works without logging in too.
  async search(term, size = 5) {
    const d = await this.api('GET', '/product/v1/product', { params: { 'filter[keyword]': term, page_size: size, store_identifier: this.store } });
    return (d?.products || []).map(p => ({ uid: p.product_uid, name: p.name, price: p.retail_price?.price, available: p.is_available !== false, offer: p.promotions?.[0]?.strap_line || '' }));
  }

  async slots(weeks = [1, 2]) {
    const out = [];
    for (const week_number of weeks) {
      const d = await this.api('POST', '/slot/v2/slots', { override: 'GET', body: { week_number, slot_type: 'DELIVERY', product_uids: [], is_slot_locked: false, store_identifier: this.store, delivery_type: ['saver_slot', '1hour'] } });
      out.push(...(d?.slots || []));
    }
    const seen = new Set();
    return out.filter(s => s.is_available && s.slot_type === '1hour' && !seen.has(s.start_time) && seen.add(s.start_time));
  }

  async reserve(slot) {
    const d = await this.api('POST', '/slot/v1/slot/reservation', { body: { booking_key: slot.booking_key, changes_confirmed: false, new_slot_date: slot.start_time, new_store_number: this.store } });
    if (d?.status !== 'success') throw new Error('Sainsbury\'s wouldn\'t book that slot.');
    return d.reservation;
  }
  release() { return this.api('DELETE', '/slot/v1/slot/reservation'); }
  reservation() { return this.api('GET', '/slot/v1/slot/reservation'); }

  async basket(slotDate) {
    const params = { store_number: this.store };
    if (slotDate) Object.assign(params, { calculate: 'true', pick_time: `${slotDate}T00:00:00Z`, slot_booked: 'true' });
    return this.api('GET', '/basket/v2/basket', { params }).catch(() => this.api('GET', '/basket/v2/basket', { params: { store_number: this.store } }));
  }

  async add(uid, quantity, slotDate) {
    return this.api('POST', '/basket/v2/basket/item', {
      params: { pick_time: `${slotDate}T00:00:00Z`, store_number: this.store, slot_booked: 'true' },
      body: { product_uid: String(uid), quantity, uom: 'ea', selected_catchweight: '' },
    });
  }

  async orders() {
    const d = await this.api('GET', '/order/v1/order', { params: { page_size: 10, page_number: 1 } });
    return d?.orders || [];
  }

  // Goes trolley → checkout → summary and presses "Place order". Returns { orderNumber, card, total }.
  // If the bank asks for an extra check, throws an error with code 'BANK_CHECK'.
  async placeOrder(expectedTotal) {
    const p = this.page;
    await p.goto(`${SITE}/gol-ui/trolley`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(6000);
    await this.dismissCookies();
    for (let i = 0; i < 4 && !/checkout\/summary/.test(p.url()); i++) {
      const btn = p.getByRole('button', { name: /^(Checkout|Continue to checkout)$/i }).first();
      await btn.click({ timeout: 20000 });
      await p.waitForTimeout(6000);
    }
    if (!/checkout\/summary/.test(p.url())) throw new Error(`Couldn't reach the checkout summary (stopped at ${p.url()}).`);
    const text = await p.innerText('body');
    const total = Number((text.match(/Total to pay\s*£([\d.,]+)/i) || [])[1]?.replace(',', ''));
    if (expectedTotal && total && Math.abs(total - expectedTotal) > 0.5) {
      throw new Error(`The total changed from £${expectedTotal.toFixed(2)} to £${total.toFixed(2)}, so I didn't place the order. Build the order again to check it.`);
    }
    const card = await p.evaluate(() => {
      const r = document.querySelector('input[type=radio][name*=card i]:checked, input[type=radio]:checked');
      const l = r && (r.closest('label') || document.querySelector(`label[for="${r.id}"]`));
      return l ? l.innerText.trim().split('\n')[0] : '';
    }).catch(() => '');
    await p.getByRole('button', { name: /^Place order$/i }).first().click({ timeout: 20000 });
    await p.waitForURL(u => !/checkout\/summary/.test(String(u)), { timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(5000);
    const after = p.url();
    const body = await p.innerText('body').catch(() => '');
    if (/3d|secure|verify|authentic|challenge/i.test(after) || /verify (it's|it is) you|approve (this|the) (payment|purchase)|bank app/i.test(body)) {
      const e = new Error('Your bank wants to check the payment. Open the Sainsbury\'s app to finish it.'); e.code = 'BANK_CHECK'; throw e;
    }
    const orderNumber = (body.match(/order (?:number|no\.?)\s*:?\s*#?\s*(\d{8,})/i) || [])[1] || '';
    if (!/confirmation|order-confirmation|thank/i.test(after + body.slice(0, 2000)) && !orderNumber) {
      throw new Error(`Not sure the order went through (page: ${after}). Check the Sainsbury's app.`);
    }
    return { orderNumber, card, total };
  }
}
