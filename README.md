# Smart Agri-Ledger

Offline-first farmer operations, harvest and payment management for an agricultural
cooperative. Runs on a phone in a field with no signal, and on a laptop in the office
as a full spreadsheet.

**English and Kinyarwanda. Light and dark. One shared owner/manager account.**

**Live:** https://gania-isaro.github.io/smart-agri-ledger/

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
```

## Two ways in

**Look around first.** The demo cooperative, already full of data:

```
owner@agriledger.rw   PIN 1234
```

26 farmers, real harvests, payments and a complete ledger. A banner across the top
says plainly that the figures are generated, so nobody mistakes them for their own.

**Or create an account.** It starts completely empty: no farmers, no harvests, no
money, and nothing to delete before it is yours. You get the crop price list and the
activity catalog, because a cooperative with zero crops can register a farmer but
can never record a harvest against them, which is empty in the unhelpful sense.

Each account gets **its own database** (`smart_agri_data_<id>`). Tagging rows with an
owner id would mean one missed `where` clause leaks another cooperative's farmers and
balances into your screens; a separate database cannot leak by omission.

---

## What it does

Answers, at a glance, the questions a cooperative asks every morning:

- Who are our farmers, and what is each one doing right now?
- Who has farmed, who has harvested, and how much did they produce?
- How much money does each farmer deserve, and how much have we already paid?
- What happened on this farmer's account, and who changed it?

## The one rule everything else follows

**A balance is never stored. It is folded from transactions, every time.**

There is no `balance` column on a farmer. `src/domain/ledger.ts` sums the ledger and
returns the figure. That single decision is why:

- no screen can show a number that disagrees with another screen,
- editing a harvest quantity *posts a correction* rather than silently rewriting history,
- a mistake is **voided**: the original row stays, flagged, and a reversing entry is
  appended, because deleting money is how ledgers stop being trustworthy,
- the numbers survived an independent recomputation straight from IndexedDB: posted
  harvest credits matched quantity × price to the franc, and payment debits matched
  settled payments exactly.

## Architecture

```
src/
  domain/     pure rules: money, ledger posting, permissions, activity catalog
  services/   the "backend": every write goes through here, with permission
              checks, validation and an audit entry. No component touches the DB.
  db/         Dexie/IndexedDB schema + deterministic demo data
  components/ grid, charts, activity composer, shell, UI primitives
  screens/    dashboard, farmers, activities, production, payments, ledger, reports
  i18n/       English + Kinyarwanda, light/dark theme
```

`domain/` and `services/` have no React in them. If this ever grows a server, those
two folders move across unchanged and the permission checks run on the request path
instead, which is the point of putting them there rather than in a component.

### Offline

Records live in IndexedDB on the device, so the app is not "degraded" without a
network; it is simply working. A service worker keeps the app shell loadable, and
the manifest makes it installable to a home screen. The connection pill in the header
tells the user which state they are in, and says the app still works either way.

## Notable decisions

**Payments post to the ledger only when settled.** Pending and approved payments are
promises; promises do not move balances. This is the difference between an outstanding
figure you can act on and one you have to double-check.

**Custom activity types cannot post to the ledger.** Admins can add activity types
that fit how they actually work (see the `+` menu). Those record what happened but
never move money. Putting posting rules into a text box would undermine the one thing
the ledger depends on.

**Colour is never the only signal.** Every status ships a glyph and a word alongside
its colour. The chart palette was validated for lightness band, chroma floor,
colour-vision separation and contrast against the surface, in both themes, with the
dark steps chosen separately rather than flipped.

**Roles are enforced in the service layer, not by hiding buttons.** The owner and
manager share one account that holds every permission, but `assertCan` still runs on
every mutation, so a narrower account is a new row rather than a rewrite.

## Installing it on a phone

It is a PWA, so it installs from the browser and then behaves like any other app:
its own icon, its own window, no address bar, and it works with the network off.

- **Android (Chrome):** menu → *Add to Home screen* / *Install app*
- **iPhone (Safari):** Share → *Add to Home Screen*

It is **not** on the Play Store or App Store. Getting there means wrapping the same
code with Capacitor or a Trusted Web Activity and paying the developer fees. The app
itself would not need rewriting.

## Signing in

PINs are never stored. Each account keeps a PBKDF2-SHA256 hash at 150,000 iterations
with a per-account salt, so a four-digit PIN is slow to brute-force off a stolen
device rather than instant. Sign-in failures say the same thing whether the email or
the PIN was wrong, since naming which half failed tells whoever is holding the phone
which addresses are real.

**Forgotten PIN.** Emailing a reset link needs a server to send the mail and verify
the token, and this build has neither: it runs entirely on the device. So recovery
uses a code issued once at sign-up, and the screen says exactly that rather than
showing a "check your email" that no email would ever follow. Using a code spends it
and issues a new one, so an old screenshot cannot be replayed. Connect this to a mail
server and the same flow sends that code to the address on the account.

## Known limits

- **Single device.** There is no server, so data does not sync between phones. The
  architecture is ready for one; the sync itself is not built.
- **Authentication is local.** PINs are hashed properly, but verification happens on
  the device, so anyone with the device and the PIN is in. Real multi-device
  deployment swaps `screens/Login.tsx` and `db/accounts.ts` for an identity provider;
  nothing behind them changes.
- **No password reset by email**, for the reason above. Recovery is by a saved code.
- **The demo PIN is published** in this README on purpose. It is the only account
  allowed to use `1234`; the sign-up form rejects that PIN for everyone else.
- **Kinyarwanda covers the interface**, not user-entered data: farmer names,
  villages and notes stay exactly as typed, and CSV exports keep English column
  headers so a file shared between two users still reconciles.
- The bundle is a single ~180 KB gzipped chunk; code-splitting by route would help
  first load on a slow connection.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which typechecks, builds
and publishes to GitHub Pages. Because Pages serves a project site from a subpath,
the build sets `base` to `/smart-agri-ledger/` only under CI; local `npm run dev`
stays at the root. The manifest uses relative paths and the service worker derives
every path from its own scope, so the same files work in both places.
