// Firebase functions: run "Ask Claude for ideas", recipe links, recipe methods and missing
// ingredient lists as soon as the app asks, instead of waiting for the
// GitHub Actions worker (which still runs every few minutes as a backup).
// Orders still go through the worker, because they need a real browser, but
// a new order starts it straight away (GitHub's own timer proved unreliable).
// Meal ideas are made when someone asks for them in the app (there's no fixed
// day: order whenever the food runs out).
//
// Deploy (from Google Cloud Shell or any machine with the Firebase CLI):
//   firebase functions:secrets:set ANTHROPIC_API_KEY
//   firebase functions:secrets:set WORKER_GITHUB_TOKEN   (GitHub token: Actions read and write on this repo)
//   firebase deploy --only functions
// The shared job code is copied into ./shared by tools/copy-shared.mjs first.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { makeJobs } from './shared/worker/jobs.mjs';
import { isAllowed } from './shared/worker/access.mjs';
import { checkWorker, remindCutoff } from './tasks.mjs';

initializeApp();
const db = getFirestore();
const jobs = makeJobs(db);
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const WORKER_GITHUB_TOKEN = defineSecret('WORKER_GITHUB_TOKEN');
const REPO = 'andrewwilson201/weekly-shop-app';
// Same region as the Firestore database (London).
const opts = { region: 'europe-west2', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 300, memory: '512MiB', maxInstances: 2 };

// The Anthropic SDK reads the key from the environment. Every trigger first
// checks the household is one this app is for (worker/access.mjs), so a
// stranger who signed in can't spend the API key or start orders.
const guarded = fn => async event => {
  if (!(await isAllowed(db, event.params.hid))) { console.log('Ignored a household that is not on the access list'); return; }
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY.value();
  return fn(event);
};
const household = hid => db.collection('households').doc(hid).get();
const github = (path, init = {}) => fetch(`https://api.github.com/repos/${REPO}${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${WORKER_GITHUB_TOKEN.value()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'weekly-shop-app', ...(init.headers || {}) },
});

export const askClaude = onDocumentWritten({ ...opts, document: 'households/{hid}/weeks/{wid}' }, guarded(async event => {
  const after = event.data?.after;
  if (after?.data()?.ideasRequested !== true || event.data.before?.data()?.ideasRequested === true) return;
  if (!(await jobs.claimIdeas(after.ref))) return;
  await jobs.makeIdeas(await household(event.params.hid), event.params.wid, 'request', Object.keys(after.data().picks || {}));
}));

export const recipeLink = onDocumentCreated({ ...opts, document: 'households/{hid}/imports/{iid}' }, guarded(async event => {
  const snap = event.data;
  if (snap?.data()?.state !== 'requested' || !(await jobs.claimImport(snap.ref))) return;
  const h = await household(event.params.hid);
  await jobs.processImport({ h, ref: snap.ref, data: snap.data() });
}));

export const newMeal = onDocumentCreated({ ...opts, document: 'households/{hid}/meals/{mid}' }, guarded(async event => {
  if ((event.data?.data()?.ingredients || []).length) return;
  await jobs.fillIngredients(await household(event.params.hid), event.data.ref);
}));

// "Get the recipe": a meal picked or opened on Recipes with no method saved.
export const mealRecipe = onDocumentWritten({ ...opts, document: 'households/{hid}/meals/{mid}' }, guarded(async event => {
  const after = event.data?.after;
  if (after?.data()?.recipeRequested !== true || event.data.before?.data()?.recipeRequested === true) return;
  await jobs.fillRecipe(await household(event.params.hid), after.ref);
}));

// A new order: start the order worker on GitHub now rather than waiting for
// its timer. The worker then stays with the order until it's placed. If this
// fails, the worker won't start the order late (worker/run.mjs START_MINUTES):
// the app offers Try again instead.
export const startOrder = onDocumentCreated({ region: opts.region, document: 'households/{hid}/orders/{oid}', secrets: [WORKER_GITHUB_TOKEN], maxInstances: 2 }, async event => {
  const snap = event.data;
  if (snap?.data()?.state !== 'requested') return;
  if (!(await isAllowed(db, event.params.hid))) {
    await snap.ref.update({ state: 'cancelled', message: 'This household isn\'t set up for ordering.' });
    return;
  }
  const res = await github('/actions/workflows/order-worker.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  if (res.ok) await snap.ref.update({ workerStartedAt: new Date() });
  else {
    console.error('Could not start the order worker', res.status, await res.text().catch(() => ''));
    await snap.ref.update({ message: `The order helper didn't start straight away (GitHub said ${res.status}). GitHub's backup timer may still pick it up in the next few minutes; if not, tap Try again.` });
  }
});

// "I finished it in the Sainsbury's app" on a stopped order: mark it placed and
// update staples, meals and the list (worker/jobs.mjs finishElsewhere). Only
// writes to the database; it never contacts Sainsbury's.
export const finishedElsewhere = onDocumentUpdated({ region: opts.region, document: 'households/{hid}/orders/{oid}', maxInstances: 2 }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  if (!after?.finishedElsewhere || before?.finishedElsewhere || after.state !== 'needs_you') return;
  if (!(await isAllowed(db, event.params.hid))) return;
  await jobs.finishElsewhere(await household(event.params.hid), event.data.after.ref);
});

// Once a week (Mondays): GitHub switches off a repo's timed workflows after 60
// days with no changes, and a switched-off workflow can't be started by
// startOrder either, so switch the order worker back on. Also check the GitHub
// token still works and when it expires: the result shows in Settings › Order
// helper, and phones are told when it has stopped working or has 14 days left.
export const keepWorkerOn = onSchedule({ region: opts.region, schedule: '0 6 * * 1', timeZone: 'Europe/London', secrets: [WORKER_GITHUB_TOKEN], maxInstances: 1 }, async () => {
  await checkWorker(db, github);
});
// The evening before a delivery (Sainsbury's lets you change an order until
// late the night before): if anything is waiting on the shared list, say so,
// with a link to add it to the order. Runs every evening but only sends when
// there's an order arriving tomorrow, so there's no fixed shopping day.
export const cutoffReminder = onSchedule({ region: opts.region, schedule: '0 18 * * *', timeZone: 'Europe/London', maxInstances: 1 }, async () => {
  await remindCutoff(db);
});
