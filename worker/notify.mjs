// Phone notifications through Firebase Cloud Messaging, to every phone in the
// household that turned them on (households/{hid}/devices). Sent as data
// messages; sw.js shows them. Never throws: a notification is a nice-to-have.
import { getMessaging } from 'firebase-admin/messaging';

const SITE = process.env.SITE_URL || 'https://weekly-shop-177b1.web.app/';

export async function notify(h, { title, body, link = '', tag = '' }) {
  try {
    const devices = (await h.ref.collection('devices').get()).docs;
    if (!devices.length || process.env.FIRESTORE_EMULATOR_HOST) return 0;
    const res = await getMessaging().sendEach(devices.map(d => ({
      token: d.data().token,
      data: { title, body, link: SITE + link, tag },
      webpush: { headers: { Urgency: 'high', TTL: String(6 * 3600) } },
    })));
    // Phones that uninstalled or turned it off: forget them.
    await Promise.all(res.responses.map((r, i) => !r.success && /registration-token-not-registered|invalid-argument|invalid-registration/.test(r.error?.code || '') ? devices[i].ref.delete() : null));
    return res.successCount;
  } catch (e) {
    console.log(`Notification not sent: ${e.message}`);
    return 0;
  }
}
