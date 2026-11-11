# Weekly Shop

A phone app for planning the weekly Sainsbury's shop together: pick the week's meals, keep one shared shopping list, and send it all to Sainsbury's, with a final total to approve before anything is ordered.

It's built the same way as [music-app](https://github.com/andrewwilson201/music-app): a static site (plain HTML, CSS and JavaScript, no build step) on GitHub Pages, with Firebase Auth and Firestore in its own Firebase project (kept apart from the music app's, so neither app's key or rules can affect the other). The Sainsbury's part runs as a scheduled GitHub Actions job.

## How it works

- **Household**: the first person signs in with Google and makes a household. Settings › Share invite link sends a link; whoever opens it and signs in joins. Everything (meals, list, staples, orders) lives under `households/{id}` and only members can read or write it ([`firestore.rules`](firestore.rules)). Changes show up live on both phones.
- **Next shop**: the shop being planned, not a calendar week. There's no fixed shopping day: when you're running low, open the app and make ideas with **Ask Claude for ideas** or **Pick from our meals now**. 10 meal ideas, favourites (most often picked) first, then ones you haven't had for a while; each shows its cooking time. Either person taps to pick as many dinners as they need, and chooses a delivery day. A plan stays open until it's ordered, then the next one starts ([`js/plan.js`](js/plan.js) `currentPlanId`: plans are `weeks/{start date}`, with -2, -3 for a second one the same day); **Start afresh** puts one aside. Until a placed order arrives, the screen shows it (*Arriving Thu 12 Nov, 8–9*) with a way to add forgotten things. Ideas nobody picks stay out of the meal library: they're under Meals › *Ideas you didn't pick*, and join the library once picked (or with **Add to meals**).
- **Recipes**: the dinners you've shopped for, each with its recipe: the page's own ingredients (with amounts) and method for recipe links and recipe-site ideas, or a method Claude writes for the household for the rest (marked as Claude's, with a link to the original page if there is one). A dinner is fetched or written when it's picked, so it's ready by cooking time. Each one stays on Recipes until someone taps **Cooked** (or **Not making it**), so the last shop's dinners are still there after the next one is ordered, and Next shop says how many are left once they've arrived. Earlier plans count only if an order went ahead for them. On a recipe, tap a step to tick it off, and **Keep screen on** stops the phone going dark while you cook ([`js/plan.js`](js/plan.js) `toCook`). After **Cooked it** the app asks **Would you make it again?** with an optional note; Claude reads the answers when it picks ideas, and a “no” stops that dinner being suggested again.
- **Serving sizes**: Settings › Household › *Cooking for* (4 by default). A recipe that serves a different number has its ingredient amounts scaled on the recipe and its packs scaled in the shop (rounded, at least 1; changes under a quarter are ignored). The − / + on a recipe changes it for that meal only ([`js/plan.js`](js/plan.js) `scaleLine`, `scaleQty`).
- **List**: the shared shopping list. Type “olive oil x2” for two. Items that get ordered are removed afterwards; ones Sainsbury's didn't have stay.
- **Basket**: staples that are due, ingredients for the picked meals, and the list, merged into one list and grouped by aisle (Fruit & veg, Meat & fish, Dairy, Bakery, Food cupboard, Frozen, Drinks, Household; [`js/plan.js`](js/plan.js) `aisleOf`). Untick anything you don't need, change how many with − / +, or add something else (it goes on the shared list). The bar at the bottom gives an estimate from the prices paid last time (`meta/prices`, saved by each order), and a warning shows if the shop looks under Sainsbury's £25 minimum.
- **Recipe links**: paste a recipe's web address on Meals (or share the page to Weekly Shop from the phone's share menu, once the app is installed). Straight away (or within a few minutes without the functions) the worker reads the page's recipe data ([`worker/recipe.mjs`](worker/recipe.mjs), the schema.org Recipe most sites include), turns lines like “2 x 400g tins chopped tomatoes” into shop items, and saves it as a meal, picked for the next shop if you ticked that. Store-cupboard things (oil, salt, spices, stock) are marked *In the cupboard* and left out of the shop unless ticked.
- **Meals**: the meal library. The editor has one row per ingredient: the name, how many (− / +), *In the cupboard*, and, folded away, *Exact product* (the words to search Sainsbury's for).
- **Staples**: worked out from past orders (the rules from `build-staples.py`: every-week items always, others when due, skipped if not bought for a long time). Turn one off if you've stopped buying it. Only the ones due for the next shop are open; the rest are folded by group, and each row's details are behind **More**. On the Basket screen they're in their own section with **Skip all staples**.
- **Learning**: picks make meals favourites. A staple that's due but left out of an order counts as a skip: it's pushed back a cycle, and after 3 skips in a row it becomes a suggestion instead of being added (Staples › Undo reverses that). Buying it resets the count. Every order also logs the date on each staple bought (Staples › More) and re-learns how often it's bought: the gap since last time moves the estimate 30% of the way, and a change of 2 days or more is shown.
- **Claude ideas**: with an `ANTHROPIC_API_KEY` secret, **Ask Claude for ideas** (and **Ask Claude for fresh ideas**) on Next shop come from Claude ([`worker/ideas-claude.mjs`](worker/ideas-claude.mjs)). It sees the meal library, the last 8 weeks of what was picked and what was passed over, the staples you've been leaving out, the time of year and Settings › Household notes (ages, dislikes, allergies). It mixes favourites with 3 or 4 new dishes, each with a one-line reason and a realistic cooking time, and leans towards dishes that share ingredients so less goes to waste (the rest of a bag of spinach, the other half of a tub of crème fraîche); new dishes come with a shop ingredient list and join the meal library (marked “New from Claude”). Picks already made are kept. Without the key, or if the call fails, the rule-based ideas are used. If Claude's safety check declines a request, the API retries on another model (`fallbacks: 'default'`).
- **Recipe sites**: each time you ask for ideas, one is a recipe published in the last 7 days on The Guardian (its recipes RSS feed), chosen by Claude to suit the household, with the ingredients read from the recipe page. Settings › Recipe sites lists the sites (up to 5, one idea from each); either of you can add a site's address or RSS feed, or remove one, and it shows how the last read went. A site without a feed link on its page, or one that blocks automated reading, shows as failed there and is skipped ([`worker/feeds.mjs`](worker/feeds.mjs)). Without Claude, the newest recipe from each site is added to the rule-based ideas.
- **Variety**: Claude follows firm rules (no more than 2 of the 10 with the same main protein, at least 1 fish and 2 vegetarian, 5 or more cuisines, a mix of styles, 4 or 5 new dishes, nothing offered in the last 3 weeks unless it's a favourite). The protein rule is also checked in code, and anything dropped is topped up from the usual picks.
- **Cheaper swaps**: when the basket is filled, each line is checked against what else Sainsbury's has. Sainsbury's prices already include offers and Nectar prices (Andrew's account has Nectar); multibuys like “Buy 2 for £4 with Nectar” are counted only when the line buys enough. Claude decides which options are the same thing as the usual product (organic, free range, cut, form and fat level kept; own label for well known brands only on basics; brand kept where it's the point; household notes win), and the code buys the one with the lowest price per kg, litre or item at a similar pack size (75–135%), if it saves at least 3% and 10p. It only swaps to a product that's on offer (a price cut, Nectar price or multibuy the line gets), never just because a basic version is cheaper. The review screen lists them under **Swapped for offers**: the product, the offer, what you'd have got otherwise and the saving, with a **Switch back** button that takes the offer product out of the Sainsbury's basket and puts the original back (the worker does it while it waits for approval, and Approve waits for the new total). The usual product isn't changed, so it's checked again each week. Settings › Cheaper swaps turns it off; Staples › Always this one keeps a staple exactly as it is ([`js/plan.js`](js/plan.js) `cheapestSwap`).
- **Notifications**: Settings › Notifications turns on phone notifications for that phone (on iPhone, from the home-screen app). The worker sends one when Sainsbury's needs the SMS code (only to the person chosen in Settings › Order helper › *SMS code goes to*), when there are slots to pick, when the basket is ready to approve, and when the order is placed or needs you. The evening before a delivery (6pm) the `cutoffReminder` function says if anything is waiting on the list, with a link to add it to the order ([`worker/notify.mjs`](worker/notify.mjs), Firebase Cloud Messaging; the web push key is in `js/config.js`).
- **Missing ingredients**: a meal with no ingredient list (from the order history, or typed in by name) gets one from Claude, marked “(from Claude)” on Meals. Each meal is tried once, and you can edit the list.
- **Holiday mode**: Settings › Holiday mode takes the dates you're away. Delivery days in that time can't be picked.
- **Order history**: Order › All orders (or Settings › Order helper) lists every order placed through the app by month, with the spend, the average shop and what offer swaps saved.
- **Download your data**: Settings › Data gives everything the household has saved (meals, staples, the list, plans, orders) as one JSON file. Phones' notification tokens are left out.

## Ordering

Tapping **Send to Sainsbury's** creates an order. The `startOrder` function starts the [order worker](worker/run.mjs) on GitHub straight away (an hourly timer is the backup), and it:

1. logs in to Sainsbury's in a real browser window and waits up to 10 minutes for the **SMS code**, which either of you types into the app (the screen says whose phone it went to and counts down);
2. lists free 1-hour slots on the chosen day and the day either side; you **pick a time** and it's booked;
3. fills the basket (searching for anything without a product id) and shows the basket, anything not found, and the **total**;
4. waits for someone to tap **Approve**, then presses Place order on Sainsbury's checkout with the saved card, checking the total hasn't changed;
5. marks the staples as bought, counts the meals as picked, and clears the ordered list items.

The review screen leads with what needs a look (anything not added, offer swaps, and anything already in the Sainsbury's basket from before, each with **Remove**), then anything that costs more than last time, then the total; the full basket is folded underneath. **Refresh** reads the basket again after a change in the Sainsbury's app. Approve only counts for the total on screen.

**Add to this order**: a placed order shows **Add to this order** until the day before delivery. It sends whatever is on the shared list: the worker opens the order on Sainsbury's (Amend order), adds the items, shows the new total to approve, and confirms the change. Cancelling takes out what it added. This uses Sainsbury's amend pages, which haven't been tried on the real site yet ([`worker/sainsburys.mjs`](worker/sainsburys.mjs) `startAmend`), so the first one is worth watching.

Cancel at any point releases the slot. If the bank asks for an extra payment check, or something unexpected happens while placing the order, the app says so and you finish in the Sainsbury's app. Substitutions are off on this account.

Safety rules: an order the worker hasn't picked up within 15 minutes isn't started late (it's cancelled, and the app offers **Try again**). A run that stops part way (the computer died, GitHub cancelled it) is never restarted, because a restart would add everything to the basket again and must never act on an earlier approval; the order shows as stopped, or as *needs you* if it stopped while placing (it may have gone through). The worker won't press Place order unless it can read Sainsbury's total and it matches the approved one. Once an order is placed, nothing afterwards (tidying staples and the list) can mark it as stopped.

**Who can use it**: the address and this repo are public, so anyone with a Google account can sign in, but they can't do anything. New households can only be made while a `config/open` document exists in Firestore (it normally doesn't), and the worker and functions only serve households listed in `config/access` (`{ households: [id] }`, written automatically while there's only one household). Joining with an invite link still works. Only the admin key can read or write `config/`.

**Trial run** (Settings › Order helper): the same steps with the next shop, up to Sainsbury's checkout summary, where it reads the total and checks the Place order button is there, but doesn't press it. Then it takes out what it added and releases the slot. Nothing is recorded as bought. Use it to check everything works before relying on it.

Sainsbury's findings (Nov 2026): headless browsers get “Access Denied”, a visible browser (under `xvfb-run`) doesn't; login always needs an SMS code; slots, booking and the basket go through the site's own `/groceries-api/gol-services` API; checkout needs at least £25 of items. See [`worker/sainsburys.mjs`](worker/sainsburys.mjs). It's untested from GitHub's servers until the first real run.

## One-time setup

1. **Hosting**: the app is published to Firebase Hosting at https://weekly-shop-177b1.web.app by the `Deploy site` workflow on every push to `main` (it uses the `FIREBASE_SERVICE_ACCOUNT` secret, which needs the *Firebase Hosting Admin* role). GitHub Pages (Settings › Pages › `main` / root) stays on only to forward old links there. The shop used to live on GitHub Pages, but sharing `andrewwilson201.github.io` with the music app confused Chrome's install check on Android.
2. **Firestore rules**: the `Deploy database rules` workflow publishes [`firestore.rules`](firestore.rules) whenever it changes on `main`. The `FIREBASE_SERVICE_ACCOUNT` key needs the *Firebase Rules Admin* role for that (add `firebaserules.admin` to the roles loop under Firebase functions below). Also turn on Google sign-in under Authentication › Sign-in method.
3. **Secrets** (Settings › Secrets and variables › Actions):
   - `FIREBASE_SERVICE_ACCOUNT`: the whole JSON from Firebase console › Project settings › Service accounts › Generate new private key.
   - `SAINSBURYS_EMAIL` and `SAINSBURYS_PASSWORD`.
   - `ANTHROPIC_API_KEY` (optional, for Claude ideas): an API key from console.anthropic.com. This is pay-as-you-go and separate from a Claude subscription; a week's ideas cost a few pence.
   - `WORKER_SERVICE_ACCOUNT` (optional, recommended): a key for the order worker that can only use the database and send notifications, so the worker doesn't hold the deploy key. Without it, the worker uses `FIREBASE_SERVICE_ACCOUNT`. Make it in Cloud Shell, then paste `worker-key.json` into the secret and delete the file:
     ```sh
     gcloud iam service-accounts create order-worker --project weekly-shop-177b1 --display-name "Order worker"
     for r in datastore.user firebasecloudmessaging.admin; do
       gcloud projects add-iam-policy-binding weekly-shop-177b1 --member="serviceAccount:order-worker@weekly-shop-177b1.iam.gserviceaccount.com" --role="roles/$r" --condition=None --quiet > /dev/null && echo "added $r"
     done
     gcloud iam service-accounts keys create worker-key.json --iam-account order-worker@weekly-shop-177b1.iam.gserviceaccount.com
     ```
4. **Data**: Settings › Import loads staples and meal history from a seed file made by `python3 tools/make-seed.py staples-plan.json meal-history.json shops/*/list.json > seed.json`. The seed holds purchase history, so it isn't committed (this repo is public, and so are its Actions logs, which is why the worker keeps order details out of them).

## Firebase functions (optional, makes things instant)

Without them, “Ask Claude for ideas”, recipe links, recipe methods and missing ingredients wait for the next worker run (up to an hour, on GitHub's backup timer). The functions in [`functions/`](functions/index.mjs) do the same jobs the moment the app asks, using the same code as the worker ([`worker/jobs.mjs`](worker/jobs.mjs), copied in at deploy time). Orders still go through the worker, because they need a real browser, but `startOrder` starts the worker the moment an order is sent (GitHub's own timer can lag by hours or not fire at all). Meal ideas are only made when someone asks in the app; nothing runs on a fixed day. `keepWorkerOn` switches the order worker workflow back on every Monday, because GitHub turns off timed workflows in a repo that hasn't changed for 60 days, and a switched-off workflow can't be started by `startOrder` either. It also checks the GitHub token still works and when it runs out: Settings › Order helper shows the result, and phones are told when it's refused or has 14 days or fewer left. `cutoffReminder` runs at 6pm each day for the evening-before reminder. The worker token is a fine-grained GitHub token for this repo with **Actions: read and write**; when it's about to run out, make a new one and run `firebase functions:secrets:set WORKER_GITHUB_TOKEN` then deploy again. They need the Blaze plan; at this usage they stay inside the free allowance.

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

The functions run in `europe-west2` (London), next to the database. After that first deploy, the `Deploy functions` workflow redeploys them whenever a merge to `main` changes code they use (`functions/`, `worker/jobs.mjs`, `worker/ideas-claude.mjs`, `worker/recipe.mjs`, `worker/feeds.mjs`, `worker/notify.mjs`, `worker/access.mjs`, `js/plan.js`). It uses the same `FIREBASE_SERVICE_ACCOUNT` key as the site, which needs these extra roles once (run in Cloud Shell):

```sh
SA=$(gcloud iam service-accounts list --project weekly-shop-177b1 --filter="email~firebase-adminsdk" --format="value(email)")
for r in firebaserules.admin cloudfunctions.admin run.admin eventarc.admin cloudscheduler.admin iam.serviceAccountUser secretmanager.admin artifactregistry.admin serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding weekly-shop-177b1 --member="serviceAccount:$SA" --role="roles/$r" --condition=None --quiet > /dev/null && echo "added $r"
done
```

To redeploy by hand: Actions › Deploy functions › Run workflow, or `firebase deploy --only functions` as above.

## Run locally and test

```sh
npm install
firebase emulators:start --only auth,firestore      # Firestore on 8081, Auth on 9099
python3 -m http.server 8000                          # then open http://localhost:8000/?emulator
npm test                                             # unit tests: due rule, skips, holiday weeks, shop merging, recipe parsing
node tools/copy-shared.mjs && npm --prefix functions install && node test/functions-check.mjs   # function handlers, pretend Claude
sh test/reset-emulators.sh && node test/e2e.mjs      # two people, a recipe link, pretend Claude ideas (CLAUDE_FAKE=1), a pretend shop (SAINSBURYS_FAKE=1), order to "placed", a trial run, adding to the order
# The e2e test uses made-up staples (test/fixtures/staples.json); SEED=seed.json uses a real seed instead.
```

With `?emulator` the sign-in page also offers a test email sign-in, because Google sign-in needs Google's servers. The `Tests` workflow runs all three on every pull request.

The app's code: [`js/app.js`](js/app.js) loads the screens in [`js/views/`](js/views) (one file each); [`js/core.js`](js/core.js) is the shell (routing, rendering, tap handlers), [`js/state.js`](js/state.js) works out the plan, its order and the shop from the live data ([`js/store.js`](js/store.js)), and [`js/plan.js`](js/plan.js) holds the rules shared with the worker. Every import carries the same `?v=` number; bump it everywhere (and in `index.html`) when the app changes.

`vendor/firebase.js` is the Firebase SDK bundled from [`tools/firebase-entry.js`](tools/firebase-entry.js); the icons are made from `icon.svg` with `node tools/make-icons.cjs icon.svg icons`.
