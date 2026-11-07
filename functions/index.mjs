// Firebase functions: run "Ask Claude for ideas", recipe links, recipe methods and missing
// ingredient lists as soon as the app asks, instead of waiting for the
// GitHub Actions worker (which still runs every few minutes as a backup).
// Orders still go through the worker, because they need a real browser, but
// a new order starts it straight away (GitHub's own timer proved unreliable).
// Sunday's meal ideas are made here on a Firebase schedule for the same reason.
//
// Deploy (from Google Cloud Shell or any machine with the Firebase CLI):
//   firebase functions:secrets:set ANTHROPIC_API_KEY
//   firebase functions:secrets:set WORKER_GITHUB_TOKEN   (GitHub token: Actions read and write on this repo)
//   firebase deploy --only functions
// The shared job code is copied into ./shared by tools/copy-shared.mjs first.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { makeJobs } from './shared/worker/jobs.mjs';
import { notify } from './shared/worker/notify.mjs';
import { weekId, awayWeek } from './shared/js/plan.js';

initializeApp();
const db = getFirestore();
const jobs = makeJobs(db);
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const WORKER_GITHUB_TOKEN = defineSecret('WORKER_GITHUB_TOKEN');
const REPO = 'andrewwilson201/weekly-shop-app';
// Same region as the Firestore database (London).
const opts = { region: 'europe-west2', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 300, memory: '512MiB', maxInstances: 2 };

// The Anthropic SDK reads the key from the environment.
const withKey = fn => async event => { process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY.value(); return fn(event); };
const household = hid => db.collection('households').doc(hid).get();

export const askClaude = onDocumentWritten({ ...opts, document: 'households/{hid}/weeks/{wid}' }, withKey(async event => {
  const after = event.data?.after;
  if (after?.data()?.ideasRequested !== true || event.data.before?.data()?.ideasRequested === true) return;
  if (!(await jobs.claimIdeas(after.ref))) return;
  await jobs.makeIdeas(await household(event.params.hid), event.params.wid, 'request', Object.keys(after.data().picks || {}));
}));

export const recipeLink = onDocumentCreated({ ...opts, document: 'households/{hid}/imports/{iid}' }, withKey(async event => {
  const snap = event.data;
  if (snap?.data()?.state !== 'requested' || !(await jobs.claimImport(snap.ref))) return;
  const h = await household(event.params.hid);
  await jobs.processImport({ h, ref: snap.ref, data: snap.data() });
}));

export const newMeal = onDocumentCreated({ ...opts, document: 'households/{hid}/meals/{mid}' }, withKey(async event => {
  if ((event.data?.data()?.ingredients || []).length) return;
  await jobs.fillIngredients(await household(event.params.hid), event.data.ref);
}));

// "Get the recipe": a meal picked or opened on Recipes with no method saved.
export const mealRecipe = onDocumentWritten({ ...opts, document: 'households/{hid}/meals/{mid}' }, withKey(async event => {
  const after = event.data?.after;
  if (after?.data()?.recipeRequested !== true || event.data.before?.data()?.recipeRequested === true) return;
  await jobs.fillRecipe(await household(event.params.hid), after.ref);
}));

// Sunday 07:30 UK time: make each household's ideas for the week and tell
// their phones. Skips weeks that already have ideas, and weeks away.
export const sundayIdeas = onSchedule({ ...opts, schedule: '30 7 * * 0', timeZone: 'Europe/London', timeoutSeconds: 540 }, withKey(async () => {
  const sunday = weekId(new Date());
  for (const h of (await db.collection('households').get()).docs) {
    if ((await h.ref.collection('weeks').doc(sunday).get()).exists) continue;
    if (awayWeek(h.data().away, sunday)) continue;
    await jobs.makeIdeas(h, sunday, 'sunday');
    await notify(h, { title: 'This week\'s meal ideas are ready', body: 'Pick your dinners and a delivery day.', link: '#/week', tag: 'ideas' });
  }
}));

// A new order: start the order worker on GitHub now rather than waiting for
// its timer. The worker then stays with the order until it's placed.
export const startOrder = onDocumentCreated({ region: opts.region, document: 'households/{hid}/orders/{oid}', secrets: [WORKER_GITHUB_TOKEN], maxInstances: 2 }, async event => {
  const snap = event.data;
  if (snap?.data()?.state !== 'requested') return;
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/order-worker.yml/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WORKER_GITHUB_TOKEN.value()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'weekly-shop-app' },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (res.ok) await snap.ref.update({ workerStartedAt: new Date() });
  else {
    console.error('Could not start the order worker', res.status, await res.text().catch(() => ''));
    await snap.ref.update({ message: `The order helper didn't start straight away (GitHub said ${res.status}). It will be picked up on GitHub's next timed run.` });
  }
});
