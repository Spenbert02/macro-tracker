# Macro Tracker

A private macro and weight tracker, running on GitHub Pages at
<https://www.spencer-bertram.com/macro-tracker/>.

Tracks four macros and nothing else: **protein, carbs, fat, calories** — plus
body weight in pounds and a daily supplement checklist. Scans barcodes with the
phone camera, saves custom meals, graphs everything over time, and works offline.

Free forever: GitHub Pages for hosting, Firebase's free Spark tier for storage
and sign-in, Open Food Facts for barcode lookups. No build step, no npm, no
server. Just static files.

---

## Setup

You only do this once. Budget about fifteen minutes.

### 1. Create the Firebase project

At <https://console.firebase.google.com>:

1. **Add project** → name it `macro-tracker` → **turn Google Analytics off**
   (nothing here uses it).
2. **Build → Authentication → Get started**, then under **Sign-in method**:
   - Enable **Google**. Set the public-facing name to `Macro Tracker` and pick
     your support email.
   - Enable **Email/Password**. Leave "Email link (passwordless)" off.
     **Do not skip this one** — see [Why two sign-in methods](#why-two-sign-in-methods).
   - Under **Settings → Authorized domains**, add `www.spencer-bertram.com`.
     (`localhost` is already there.)
3. **Build → Firestore Database → Create database**:
   - Start in **production mode** (it begins locked down, which is correct).
   - Location: `nam5` or `us-central1`.
     ⚠️ **This is permanent.** Changing it later means recreating the project.
4. **Firestore → Rules** → paste in the contents of [`firestore.rules`](firestore.rules),
   placeholder and all → **Publish**. Everything is denied at this point. That's expected.
5. **Project settings ⚙ → General → Your apps → `</>` (Web)**:
   - Nickname `macro-tracker-web`. **Do not tick "Also set up Firebase Hosting."**
   - Copy the `firebaseConfig` object it shows you.

### 2. Wire it up

6. Paste that config into [`js/config.js`](js/config.js) as `FIREBASE_CONFIG`.
7. Commit and push to `main`. Give Pages about a minute.
8. Open the site **on a desktop browser** and sign in with Google.
9. The app will say *"One more step"* and show your **user ID** with a Copy button.
10. Paste that ID into **both** places:
    - `OWNER_UID` in `js/config.js` → commit and push
    - `ownerUid()` in the Firebase console's **Firestore → Rules** → **Publish**
11. Reload. You're in. Set your targets under Settings.

### 3. Get it on your phone

12. Still on desktop: **Settings → Set a password**. This attaches a password to
    the *same account* — same user ID, same data, rules unchanged.
13. On the iPhone: open the site in Safari → **Share → Add to Home Screen** →
    launch it from the icon → sign in with **email and password**.
14. Allow camera access the first time you scan. That's it — you won't sign in again.

---

## Why two sign-in methods

Google sign-in does not work inside an installed iOS web app, in either of the
two ways Firebase offers:

- `signInWithPopup` — since iOS 17.5 the popup's `window.opener` is `null`, so
  the auth handler's `postMessage` never reaches the app. It just spins forever.
- `signInWithRedirect` — broken by Safari's third-party storage blocking
  ([Firebase documents this](https://firebase.google.com/docs/auth/web/redirect-best-practices)),
  and it navigates out of the app's scope to `<project>.firebaseapp.com`, which
  iOS opens in a view the app can't come back from.

So: Google on the desktop, a linked password on the phone. Both are the same
Firebase user with the same uid, so the security rules never change and your
data is the same data. The app hides the Google button when it detects it's
running as an installed iOS app, rather than offering you a button that hangs.

---

## Every deploy

Bump the version in **two** files before you push:

- `APP_VERSION` in `js/config.js`
- `VERSION` in `sw.js`

They must match. Miss it and the service worker keeps serving the old cached
vendor bundles.

---

## Running it locally

```sh
python3 -m http.server 8000
```

Then <http://localhost:8000>. `localhost` counts as a secure origin, so the
camera works there — but `http://192.168.x.x` does **not**, so testing the
scanner over your LAN by IP will fail. Use the real deployed site on the phone,
or a tunnel.

### Checking the logic

`js/macros.js` and `js/dates.js` are pure — no imports, no browser APIs — so
they can be exercised directly:

```sh
deno run --allow-read test/logic.test.mjs      # macro math, goal rules, day keys
deno run --allow-net --allow-read test/off.test.mjs   # live Open Food Facts parsing
```

---

## How it's put together

```
index.html          one document; everything is hash-routed (#/entry, #/viewer, #/settings)
sw.js               offline shell — network-first for app code, cache-first for pinned vendor
firestore.rules     the entire security boundary
js/
  config.js         the only file you hand-edit
  firebase.js       SDK init; exports app / auth / db
  auth.js           sign-in, and the iOS password workaround
  store.js          the only module that touches Firestore
  state.js          ~40-line pub/sub store
  dates.js          local-timezone day keys (pure)
  macros.js         macro math and goal rules (pure)
  entryModel.js     the shape of a logged item (pure)
  off.js            Open Food Facts lookup
  scanner.js        camera + barcode decoding
  supplements.js    the supplement list and adherence counting (pure)
  charts.js         Chart.js wrappers
  ui/               one module per screen
```

### Goal colouring

Each macro is judged by its own rule, all of them editable in Settings:

| | rule | green when |
|---|---|---|
| Protein | `min` | at or above target |
| Carbs | `max` | at or below target |
| Fat | `max` | at or below target |
| Calories | `band` | within ±5% of target (the band width is a setting) |

There are only two states, green and red — a day with nothing logged yet is red,
because you haven't hit the goal. The target itself is always on screen next to
the number, so a red tile tells you how far off you are, not just that you're off.

### Weight goal

Settings has a **target change** in pounds per month — negative to lose,
positive to gain, `0` to switch it off. The Viewer then draws it as a dashed line
on the weight chart, starting from your **fitted** weight at the beginning of
whichever range you're looking at (a least-squares fit, not the first raw
reading, so one heavy morning doesn't drag the whole goal line with it).

Alongside it, the stat strip shows your actual fitted trend in the same units, so
the two compare directly. It turns green when you're within half a pound a month
of the target or already past it in the direction you asked for.

### Supplements

Settings holds an ordered list — add, rename, reorder, remove. Each one gets an
id, and it's the **id** that days record, so renaming "Vit D" to "Vitamin D"
keeps every day you already ticked.

They show up on the Entry page as a checkbox per supplement with an `n/3`
counter that turns green on a clean sweep. Ticking repaints immediately and
writes the whole array after half a second, so a tap is instant whether or not
you have signal.

The Viewer gets a bar per supplement — days taken out of days in the range —
plus an **All of them** bar for days you took every one, and a matching stat
tile. Counts come straight off the day documents rather than the bucketed chart
points, since these are whole-day counts and averaging them into weekly buckets
would only blur an exact number.

Removing a supplement stops it appearing on the Entry page and in the chart, but
days you already ticked keep their record, and a removed supplement never
retroactively spoils an "All of them" day.

### Data model

```
users/{uid}                     targets, goal modes, timezone, supplement list
users/{uid}/days/{YYYY-MM-DD}   one doc per day: entries array, weight, supplements taken
users/{uid}/foods/{foodId}      your food library, and the barcode cache
users/{uid}/meals/{mealId}      saved meals
```

One document per day rather than one per entry: a 365-day chart costs 365 reads
instead of roughly 4,400, which is the difference between about 136 and about 11
full-year chart loads before the free tier's 50,000 daily reads runs out. The
trade is that two devices editing the same day at the same moment is
last-write-wins, which for one person is fine.

The day-key is in **your** timezone, not UTC. Food logged at 11pm belongs to
today. Change the timezone in Settings if you move.

### Three things that are easy to get wrong

**Calories vs kilojoules.** Open Food Facts' `energy_100g` field carries
whatever unit the contributor entered — for a Clif bar it's `1710.29` kJ. Read
it as calories and you log a 250-calorie bar as 1710. `js/off.js` only ever
reads `energy-kcal_*`, converts from `energy-kj_*` when it has to, and checks
the stated unit before touching the ambiguous field. Anything that still looks
off gets flagged in the UI against `4P + 4C + 9F`.

**Rate limits.** Open Food Facts allows 15 product reads a minute per IP and says
plainly they'll ban IPs over it. Every lookup is cached as a food document in
Firestore, so a given product is fetched at most once ever, and a repeat scan
resolves instantly from the local cache — offline included.

**Supplement adherence has all days as its denominator** — not just days you
logged food. A day you ate nothing and took nothing still counts against you,
which is the point of tracking it. Pick a shorter range to see recent adherence.

**Underscore files.** GitHub Pages runs Jekyll, which silently drops anything
starting with `_`. The empty `.nojekyll` at the repo root is what prevents that.
Don't delete it.

---

## Notes

- The `apiKey` in `config.js` is **not** a secret. A Firebase web API key is a
  project identifier; Google documents it as safe to publish. The rules are the
  security.
- Because the project is public, a stranger can sign in and consume an Auth user
  slot. They can't read or write anything — the rules deny every uid but yours.
- Free-tier ceilings are 50,000 reads and 20,000 writes a day, and 1 GiB stored.
  Realistic use here is tens of writes and a few hundred reads a day; a decade of
  day documents is around 7 MB. When a quota does run out Firebase simply stops
  responding until it resets — there's no overage and no bill.
- Nothing here uses Cloud Functions, which now require the paid plan.
