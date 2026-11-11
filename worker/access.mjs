// Which households the order helper, the functions and Claude work for.
//
// The app's address and this repo are public, so anyone with a Google account
// could sign in. The database rules stop new households being made (see
// firestore.rules), and as a second lock everything that spends money or uses
// the Sainsbury's account only serves the households listed in config/access
// ({ households: [id, ...] }). Only the admin key can read or write config/:
// the app can't. If the list is missing and there's exactly one household,
// that one is written in; if there are more, none are served until someone
// sets the list by hand in the Firebase console (Firestore › config › access).

const CACHE_MS = 60 * 1000;
let cache = null;

// Tests against the emulator serve every household unless ACCESS_CHECK is set.
const skip = () => process.env.FIRESTORE_EMULATOR_HOST && !process.env.ACCESS_CHECK;

// Returns the allowed household ids, or null for "all" (emulator tests only).
export async function allowedHouseholds(db) {
  if (skip()) return null;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.ids;
  const ref = db.collection('config').doc('access');
  let ids = (await ref.get()).data()?.households;
  if (!Array.isArray(ids)) {
    const all = (await db.collection('households').select().get()).docs.map(d => d.id);
    if (all.length === 1) {
      ids = all;
      await ref.set({ households: ids, setAt: new Date(), note: 'Set automatically: the only household when the access check started.' });
    } else {
      // Kept vague on purpose: the Actions log is public.
      console.error(`The access list (config/access) isn't set and there are ${all.length} households, so none are served. Set it in the Firebase console.`);
      ids = [];
    }
  }
  cache = { at: Date.now(), ids };
  return ids;
}

export async function isAllowed(db, hid) {
  const ids = await allowedHouseholds(db);
  return ids === null || ids.includes(hid);
}

// The household documents to work on.
export async function households(db) {
  const ids = await allowedHouseholds(db);
  if (ids === null) return (await db.collection('households').get()).docs;
  const snaps = await Promise.all(ids.map(id => db.collection('households').doc(id).get()));
  return snaps.filter(s => s.exists);
}

export const forgetAccessCache = () => { cache = null; };
