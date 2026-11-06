// Before `firebase deploy --only functions`: copy the job code the functions
// share with the worker into functions/shared (it isn't committed there).
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
const root = new URL('..', import.meta.url);
const out = new URL('functions/shared/', root);
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('worker/', out), { recursive: true });
mkdirSync(new URL('js/', out), { recursive: true });
for (const f of ['worker/jobs.mjs', 'worker/recipe.mjs', 'worker/ideas-claude.mjs', 'js/plan.js']) copyFileSync(new URL(f, root), new URL(f, out));
console.log('Copied shared code into functions/shared');
