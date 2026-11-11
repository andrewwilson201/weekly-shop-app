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
    if (res.status >= 400) {
      const e = new Error(`${method} ${path} → ${res.status}`); e.status = res.status; e.data = data;
      // What Sainsbury's said, for the order screen (kept out of the public Actions log).
      const said = typeof data === 'string' ? data : data?.errors?.[0]?.message || data?.errors?.[0]?.detail || data?.message || data?.error?.message || data?.error_description || data?.errors?.[0]?.code || (data ? JSON.stringify(data) : '');
      e.detail = String(said || '').replace(/\s+/g, ' ').slice(0, 300);
      throw e;
    }
    return data;
  }

  // Product search works without logging in too.
  // Prices are after any offer, Nectar prices included (Sainsbury's shows those
  // logged out too); was = the unit price before the offer. Multibuys
  // ("Buy 2 for £4.00 with Nectar") aren't in the price: see js/plan.js.
  async search(term, size = 5) {
    const d = await this.api('GET', '/product/v1/product', { params: { 'filter[keyword]': term, page_size: size, store_identifier: this.store } });
    return (d?.products || []).map(p => {
      const cw = p.catchweight?.[0];
      const unit = p.unit_price || cw?.unit_price || {};
      return {
        uid: p.product_uid, name: p.name, price: p.retail_price?.price ?? cw?.retail_price?.price, available: p.is_available !== false,
        offer: p.promotions?.[0]?.strap_line || '', unit: unit.price, measure: unit.measure, per: unit.measure_amount || 1,
        was: p.original_unit_price?.price, catchweight: p.product_type === 'CATCHWEIGHT',
      };
    });
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
    const book = changes_confirmed => this.api('POST', '/slot/v1/slot/reservation', { body: { booking_key: slot.booking_key, changes_confirmed, new_slot_date: slot.start_time, new_store_number: this.store } });
    let d;
    try { d = await book(false); }
    catch (e) {
      // Sainsbury's asks to confirm changes when the account already has a slot
      // or a basket the new slot affects: confirm once, then give up.
      if (e.status !== 400) throw e;
      this.log(`Booking said: ${e.detail || 'no reason given'}; trying again with the change confirmed`);
      try { d = await book(true); }
      catch (e2) {
        const err = new Error(`Sainsbury's wouldn't book that slot${e2.detail || e.detail ? `: ${e2.detail || e.detail}` : '.'}`);
        err.status = e2.status; err.detail = e2.detail; throw err;
      }
    }
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

  // Take `quantity` of a product back out of the basket (all of it if that's all there is).
  async remove(uid, quantity, slotDate) {
    const item = ((await this.basket())?.items || []).find(i => String(i.product?.sku ?? i.product_uid) === String(uid));
    if (!item) return;
    const left = Math.max(0, item.quantity - quantity);
    await this.api('PUT', '/basket/v2/basket', {
      params: { pick_time: `${slotDate}T00:00:00Z`, store_number: this.store, slot_booked: 'true' },
      body: { items: [{ product_uid: String(uid), quantity: left, uom: 'ea', selected_catchweight: '', item_uid: item.item_uid, decreasing_quantity: true }] },
    });
  }

  async orders() {
    const d = await this.api('GET', '/order/v1/order', { params: { page_size: 10, page_number: 1 } });
    return d?.orders || [];
  }

  // Goes trolley → checkout → summary and presses "Place order". Returns { orderNumber, card, total }.
  // If the bank asks for an extra check, throws an error with code 'BANK_CHECK'.
  // dryRun: stop at the summary without pressing Place order (Settings › Order helper › Trial run).
  // amend: the basket is a placed order being changed, so the last button
  // confirms the changes instead of placing a new order.
  async placeOrder(expectedTotal, { dryRun = false, amend = false } = {}) {
    const p = this.page;
    await p.goto(`${SITE}/gol-ui/trolley`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(6000);
    await this.dismissCookies();
    for (let i = 0; i < 4 && !/checkout\/summary/.test(p.url()); i++) {
      const btn = p.getByRole('button', { name: /^(Checkout|Continue to checkout|Checkout changes)$/i }).first();
      await btn.click({ timeout: 20000 });
      await p.waitForTimeout(6000);
    }
    if (!/checkout\/summary/.test(p.url())) throw new Error(`Couldn't reach the checkout summary (stopped at ${p.url()}).`);
    const text = await p.innerText('body');
    const total = Number((text.match(/(?:New total|Total to pay)\s*£([\d.,]+)/i) || [])[1]?.replace(',', ''));
    // Never pay without checking the total: if it can't be read (Sainsbury's
    // changed the page), stop here.
    if (!(total > 0)) throw new Error('Couldn\'t read the total on Sainsbury\'s checkout page, so I didn\'t place the order. Check out in the Sainsbury\'s app.');
    if (expectedTotal && Math.abs(total - expectedTotal) > 0.5) {
      throw new Error(`The total changed from £${expectedTotal.toFixed(2)} to £${total.toFixed(2)}, so I didn't place the order. Build the order again to check it.`);
    }
    const card = await p.evaluate(() => {
      const r = document.querySelector('input[type=radio][name*=card i]:checked, input[type=radio]:checked');
      const l = r && (r.closest('label') || document.querySelector(`label[for="${r.id}"]`));
      return l ? l.innerText.trim().split('\n')[0] : '';
    }).catch(() => '');
    const finalButton = p.getByRole('button', { name: amend ? /^(Confirm changes|Update order|Save changes|Place order)$/i : /^Place order$/i }).first();
    if (dryRun) {
      if (!(await finalButton.isVisible().catch(() => false))) throw new Error('Reached checkout, but couldn\'t find the Place order button.');
      return { orderNumber: '', card, total, dryRun: true };
    }
    await finalButton.click({ timeout: 20000 });
    await p.waitForURL(u => !/checkout\/summary/.test(String(u)), { timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(5000);
    const after = p.url();
    const body = await p.innerText('body').catch(() => '');
    if (/3d|secure|verify|authentic|challenge/i.test(after) || /verify (it's|it is) you|approve (this|the) (payment|purchase)|bank app/i.test(body)) {
      const e = new Error('Your bank wants to check the payment. Open the Sainsbury\'s app to finish it.'); e.code = 'BANK_CHECK'; throw e;
    }
    const orderNumber = (body.match(/order (?:number|no\.?)\s*:?\s*#?\s*(\d{8,})/i) || [])[1] || '';
    if (!/confirmation|order-confirmation|thank|updated|changes (have been )?saved/i.test(after + body.slice(0, 2000)) && !orderNumber) {
      throw new Error(`Not sure the ${amend ? 'change' : 'order'} went through (page: ${after}). Check the Sainsbury's app.`);
    }
    return { orderNumber, card, total };
  }

  // ---------- Adding to a placed order ----------
  // Untested against the real site until the first real use (Nov 2026): it
  // follows the website's own "Amend order" button, and stops with a clear
  // message whenever a page isn't what it expects. Nothing is confirmed
  // without the total check above and someone tapping Approve.
  async startAmend(orderNumber) {
    const p = this.page;
    const o = (await this.orders()).find(x => String(x.order_uid) === String(orderNumber));
    if (!o) throw new Error(`Couldn't find order ${orderNumber} on Sainsbury's.`);
    if (o.is_amendable === false || o.can_amend === false || /cancel|deliver|complete|picked/i.test(String(o.status || ''))) {
      throw new Error('Sainsbury\'s says this order can\'t be changed any more (it may be past the cut-off).');
    }
    await p.goto(`${SITE}/gol-ui/my-account/orders/${orderNumber}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(6000);
    await this.dismissCookies();
    const amend = p.getByRole('button', { name: /amend|change order|edit order/i }).or(p.getByRole('link', { name: /amend|change order|edit order/i })).first();
    await amend.click({ timeout: 20000 }).catch(() => { throw new Error('Couldn\'t find the Amend order button on Sainsbury\'s order page. Add the items in the Sainsbury\'s app instead.'); });
    await p.waitForTimeout(5000);
    // Some versions ask "Are you sure?"
    await p.getByRole('button', { name: /^(amend order|yes|continue|confirm|start amending)$/i }).first().click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(5000);
    const basket = await this.basket();
    if (!basket?.items?.length) throw new Error('Opened the order to change it, but Sainsbury\'s basket didn\'t show the order\'s items, so I stopped. Check the Sainsbury\'s app.');
    const start = o.slot_start_time || o.slot?.start_time || o.delivery_slot?.start_time || null;
    const end = o.slot_end_time || o.slot?.end_time || o.delivery_slot?.end_time || '';
    if (!start) throw new Error('Couldn\'t tell the order\'s delivery time from Sainsbury\'s, so I stopped.');
    return { slotDate: String(start).slice(0, 10), slot: { start_time: start, end_time: end } };
  }
  confirmAmend(expectedTotal) { return this.placeOrder(expectedTotal, { amend: true }); }
  // Leave the order as it was: Sainsbury's "Cancel changes".
  async cancelAmend() {
    const p = this.page;
    await p.goto(`${SITE}/gol-ui/trolley`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(5000);
    await p.getByRole('button', { name: /cancel (changes|amend)/i }).first().click({ timeout: 15000 });
    await p.waitForTimeout(3000);
    await p.getByRole('button', { name: /^(yes|cancel changes|confirm)/i }).first().click({ timeout: 5000 }).catch(() => {});
  }
}
