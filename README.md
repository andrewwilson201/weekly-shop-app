# Weekly Shop

A phone app for planning the weekly Sainsbury's shop together: pick the week's meals, keep one shared shopping list, and send it all to Sainsbury's, with a final total to approve before anything is ordered.

It's built the same way as [music-app](https://github.com/andrewwilson201/music-app): a static site (plain HTML, CSS and JavaScript, no build step) on GitHub Pages, with Firebase Auth and Firestore in its own Firebase project (kept apart from the music app's, so neither app's key or rules can affect the other). The Sainsbury's part runs as a scheduled GitHub Actions job.

## How it works

- **Household**: the first person signs in with Google and makes a household. Settings › Share invite link sends a link; whoever opens it and signs in joins. Everything (meals, list, staples, orders) lives under `households/{id}` and only members can read or write it ([`firestore.rules`](firestore.rules)). Changes show up live on both phones.
- **This week**: 10 meal ideas, favourites (most often picked) first, then ones you haven't had for a while. Either person taps to pick, and chooses a delivery day. Ideas are made each Sunday morning by the *Sunday meal ideas* workflow, or with the button in the app.
- **List**: the shared shopping list. Type “olive oil x2” for two. Items that get ordered are removed afterwards; ones Sainsbury's didn't have stay.
- **Shop**: staples that are due, ingredients for the picked meals, and the list, merged into one list. Untick anything you don't need.
- **Recipe links**: paste a recipe's web address on Meals (or share the page to Weekly Shop from the phone's share menu, once the app is installed). Straight away (or within a few minutes without the functions) the worker reads the page's recipe data ([`worker/recipe.mjs`](worker/recipe.mjs), the schema.org Recipe most sites include), turns lines like “2 x 400g tins chopped tomatoes” into shop items, and saves it as a meal, picked for this week if you ticked that. Store-cupboard things (oil, salt, spices, stock) are marked “(cupboard)” and left out of the shop unless ticked.
- **Meals**: the meal library. Each ingredient line is “item x2 | search words”; the search words pick the Sainsbury's product.
- **Staples**: worked out from past orders (the rules from `build-staples.py`: every-week items always, others when due, skipped if not bought for a long time). Turn one off if you've stopped buying it. On the Shop screen they're in their own section with **Skip all staples**.
- **Learning**: picks make meals favourites. A staple that's due but left out of an order counts as a skip: it's pushed back a cycle, and after 3 skips in a row it becomes a suggestion instead of being added (Staples › Undo reverses that). Buying it resets the count. Every order also logs the date on each staple bought (Staples › Bought N×, see when) and re-learns how often it's bought: the gap since last time moves the estimate 30% of the way, and a change of 2 days or more is shown.
- **Claude ideas**: with an `ANTHROPIC_API_KEY` secret, the Sunday ideas (and **Ask Claude for fresh ideas** on This week) come from Claude ([`worker/ideas-claude.mjs`](worker/ideas-claude.mjs)). It sees the meal library, the last 8 weeks of what was picked and what was passed over, the staples you've been leaving out, the time of year and Settings › Household notes (ages, dislikes, allergies). It mixes favourites with 3 or 4 new dishes, each with a one-line reason; new dishes come with a shop ingredient list and join the meal library (marked “New from Claude”). Picks already made are kept. Without the key, or if the call fails, the rule-based ideas are used. If Claude's safety check declines a request, the API retries on another model (`fallbacks: 'default'`).
- **Variety**: Claude follows firm rules (no more than 2 of the 10 with the same main protein, at least 1 fish and 2 vegetarian, 5 or more cuisines, a mix of styles, 4 or 5 new dishes, nothing offered in the last 3 weeks unless it's a favourite). The protein rule is also checked in code, and anything dropped is topped up from the usual picks.
- **Notifications**: Settings › Notifications turns on phone notifications for that phone (on iPhone, from the home-screen app). The worker sends one when Sunday's ideas are ready, when Sainsbury's needs the SMS code, when there are slots to pick, when the basket is ready to approve, and when the order is placed or needs you ([`worker/notify.mjs`](worker/notify.mjs), Firebase Cloud Messaging; the web push key is in `js/config.js`).
- **Missing ingredients**: a meal with no ingredient list (from the order history, or typed in by name) gets one from Claude, marked “(from Claude)” on Meals. Each meal is tried once, and you can edit the list.
- **Holiday mode**: Settings › Holiday mode takes the dates you're away. Sunday ideas pause for weeks you're away for most of, and delivery days in that time can't be picked.

## Ordering

Tapping **Order from Sainsbury's** creates an order. The [order worker](worker/run.mjs) picks it up within about 5–10 minutes (GitHub's schedule) and then:

1. logs in to Sainsbury's in a real browser window and waits for the **SMS code**, which either of you types into the app;
2. lists free 1-hour slots on the chosen day and the day either side; you **pick a time** and it's booked;
3. fills the basket (searching for anything without a product id) and shows the basket, anything not found, and the **total**;
4. waits for someone to tap **Approve**, then presses Place order on Sainsbury's checkout with the saved card, checking the total hasn't changed;
5. marks the staples as bought, counts the meals as picked, and clears the ordered list items.

Cancel at any point releases the slot. If the bank asks for an extra payment check, or something unexpected happens while placing the order, the app says so and you finish in the Sainsbury's app. Substitutions are off on this account.

Sainsbury's findings (Nov 2026): headless browsers get “Access Denied”, a visible browser (under `xvfb-run`) doesn't; login always needs an SMS code; slots, booking and the basket go through the site's own `/groceries-api/gol-services` API; checkout needs at least £25 of items. See [`worker/sainsburys.mjs`](worker/sainsburys.mjs). It's untested from GitHub's servers until the first real run.

## One-time setup

1. **GitHub Pages**: Settings › Pages › Deploy from a branch › `main` / root. The app is then at https://andrewwilson201.github.io/weekly-shop-app/ (add `andrewwilson201.github.io` under Firebase Authentication › Settings › Authorized domains).
2. **Firestore rules**: paste [`firestore.rules`](firestore.rules) into Firebase console › Firestore Database › Rules › Publish. Also turn on Google sign-in under Authentication › Sign-in method.
3. **Secrets** (Settings › Secrets and variables › Actions):
   - `FIREBASE_SERVICE_ACCOUNT`: the whole JSON from Firebase console › Project settings › Service accounts › Generate new private key.
   - `SAINSBURYS_EMAIL` and `SAINSBURYS_PASSWORD`.
   - `ANTHROPIC_API_KEY` (optional, for Claude ideas): an API key from console.anthropic.com. This is pay-as-you-go and separate from a Claude subscription; a week's ideas cost a few pence.
4. **Data**: Settings › Import loads staples and meal history from a seed file made by `python3 tools/make-seed.py staples-plan.json meal-history.json shops/*/list.json > seed.json`. The seed holds purchase history, so it isn't committed (this repo is public, and so are its Actions logs, which is why the worker keeps order details out of them).

## Firebase functions (optional, makes things instant)

Without them, “Ask Claude for ideas”, recipe links and missing ingredients wait for the next worker run (5–15 minutes, GitHub's schedule). The functions in [`functions/`](functions/index.mjs) do the same jobs the moment the app asks, using the same code as the worker ([`worker/jobs.mjs`](worker/jobs.mjs), copied in at deploy time). Orders still go through the worker, because they need a real browser, but `startOrder` starts the worker the moment an order is sent, and `sundayIdeas` makes Sunday's ideas on a Firebase schedule (GitHub's own timer can lag by hours or not fire at all). The worker token is a fine-grained GitHub token for this repo with **Actions: read and write**. They need the Blaze plan; at this usage they stay inside the free allowance.

Deploy from [Google Cloud Shell](https://shell.cloud.google.com) (the Firebase CLI is already there):

```sh
git clone https://github.com/andrewwilson201/weekly-shop-app && cd weekly-shop-app
npm --prefix functions install
firebase login --no-localhost
firebase use weekly-shop-177b1
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set WORKER_GITHUB_TOKEN
firebase deploy --only functions
```

The functions run in `europe-west2` (London), next to the database. Redeploy after changing `worker/jobs.mjs`, `worker/ideas-claude.mjs`, `worker/recipe.mjs`, `js/plan.js` or `functions/`.

## Run locally and test

```sh
npm install
firebase emulators:start --only auth,firestore      # Firestore on 8081, Auth on 9099
python3 -m http.server 8000                          # then open http://localhost:8000/?emulator
npm test                                             # unit tests: due rule, skips, holiday weeks, shop merging, recipe parsing
node tools/copy-shared.mjs && npm --prefix functions install && node test/functions-check.mjs   # function handlers, pretend Claude
sh test/reset-emulators.sh && node test/e2e.mjs      # two people, a recipe link, pretend Claude ideas (CLAUDE_FAKE=1), a pretend shop (SAINSBURYS_FAKE=1), order to "placed"
```

With `?emulator` the sign-in page also offers a test email sign-in, because Google sign-in needs Google's servers.

`vendor/firebase.js` is the Firebase SDK bundled from [`tools/firebase-entry.js`](tools/firebase-entry.js); the icons are made from `icon.svg` with `node tools/make-icons.cjs icon.svg icons`.
