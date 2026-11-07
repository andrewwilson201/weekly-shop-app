// A pretend Sainsbury's with the same methods as sainsburys.mjs, for testing
// the app and worker without touching a real account. The SMS code is 123456.
export class FakeSainsburys {
  constructor({ log = console.log } = {}) { this.log = log; this.items = []; }
  async open() {}
  async close() {}
  async login(email, password, getCode) {
    const code = await getCode();
    if (code !== '123456') throw new Error('Sainsbury\'s didn\'t accept that code.');
    this.log('Logged in (pretend shop)');
  }
  async search(term) {
    if (/nothing/i.test(term)) return [];
    const slug = term.toLowerCase().replace(/\W+/g, '-');
    const out = [{ uid: `p-${slug}`.slice(0, 40), name: `Sainsbury's ${term}`, price: 1.5, unit: 3.75, measure: 'kg', per: 1, offer: '', available: true }];
    // Beans have a cheaper equivalent on offer, to test cheaper swaps.
    if (/beans/i.test(term)) out.push({ uid: `p-cheaper-${slug}`.slice(0, 40), name: `Cheaper ${term}`, price: 1, unit: 2.5, was: 5, measure: 'kg', per: 1, offer: 'Half Price with Nectar', available: true });
    return out;
  }
  async slots() {
    const out = [];
    const base = new Date(); base.setUTCHours(0, 0, 0, 0);
    for (let d = 1; d <= 8; d++) for (const h of [8, 12, 18]) {
      const s = new Date(base.getTime() + d * 864e5 + h * 36e5);
      out.push({ start_time: s.toISOString().replace('.000', ''), end_time: new Date(s.getTime() + 36e5).toISOString().replace('.000', ''), price: h === 18 ? 1.5 : 0, is_green: h === 12, booking_key: `k${d}${h}`, is_available: true, slot_type: '1hour' });
    }
    return out;
  }
  async reserve(slot) {
    // FAKE_SLOT_GONE=1: the first slot picked has just gone, as happens on the real site.
    if (process.env.FAKE_SLOT_GONE && !this.goneOnce) { this.goneOnce = true; const e = new Error('POST /slot/v1/slot/reservation → 400'); e.status = 400; e.detail = 'Sorry this slot is no longer available.'; throw e; }
    return { reserved_until: new Date(Date.now() + 2 * 36e5).toISOString(), slot }; }
  async release() {}
  async basket() {
    const subtotal = this.items.reduce((t, i) => t + i.subtotal_price, 0);
    return { items: this.items, subtotal_price: subtotal, total_price: subtotal + 1, slot_price: 1, savings: 0, minimum_spend: 25, has_exceeded_minimum_spend: subtotal >= 25 };
  }
  async add(uid, quantity) {
    if (/unavailable/.test(uid)) { const e = new Error('400'); e.status = 400; throw e; }
    const price = 2.5;
    this.items.push({ quantity, subtotal_price: price * quantity, product: { sku: uid, name: uid.replace(/^p-/, '').replace(/-/g, ' ') }, promotions: [] });
  }
  async remove(uid, quantity) {
    const i = this.items.findIndex(x => x.product.sku === uid);
    if (i < 0) return;
    const it = this.items[i];
    it.quantity -= quantity; it.subtotal_price = 2.5 * it.quantity;
    if (it.quantity <= 0) this.items.splice(i, 1);
  }
  async orders() { return []; }
  async placeOrder(expected, { dryRun = false } = {}) {
    if (dryRun) return { orderNumber: '', card: 'Test card ending 0000', total: expected, dryRun: true };
    return { orderNumber: '1000000001', card: 'Test card ending 0000', total: expected };
  }
}
