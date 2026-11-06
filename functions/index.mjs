// Firebase functions: run "Ask Claude for ideas", recipe links and missing
// ingredient lists as soon as the app asks, instead of waiting for the
// GitHub Actions worker (which still runs every few minutes as a backup).
// Orders still go through the worker, because they need a real browser.
//
// Deploy (from Google Cloud Shell or any machine with the Firebase CLI):
//   firebase functions:secrets:set ANTHROPIC_API_KEY
//   firebase deploy --only functions
// The shared job code is copied into ./shared by tools/copy-shared.mjs first.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { makeJobs } from './shared/worker/jobs.mjs';

initializeApp();
const db = getFirestore();
const jobs = makeJobs(db);
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
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
