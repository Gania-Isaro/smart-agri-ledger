# Smart Agri-Ledger

Record keeping for a farm or cooperative that pays people for their work: one list
of workers in groups, who worked each day (with a photo taken on the spot), the
produce they bring in, and the money owed against it. It works on a phone in a field
with no signal and on a laptop in the office, and syncs between phones when there is
internet.

**It is a ledger, not a payment app.** You pay workers the way you always have, in
cash or by mobile money, in person. This records what was paid so every balance
stays correct, and tells you who is still owed. Nothing here talks to a bank, and no
button in it sends money to anyone.

**English and Kinyarwanda. Light and dark. One owner, and a manager for each group.**

**Live:** https://gania-isaro.github.io/smart-agri-ledger/

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
```

## Three ways in

**Look around first.** On the sign-in page choose *Use without an online account*,
then *Open the demo cooperative*: 26 workers in three groups, two weeks of daily
work, produce, payments and a complete ledger. A banner across the top says plainly
that the figures are generated, so nobody mistakes them for their own.

**Online, for a real cooperative.** The owner creates the account once (*New owner
account*), makes a group for each site or team, and sends each group's manager code
to the person who runs it. A manager joins with that code and from then on sees and
records only that group. The owner sees every group, the totals per day, week, month
and year, and can remove a manager at any time. Accounts and the shared copy live in
Supabase (`supabase/schema.sql`, then `supabase/groups.sql`, then
`supabase/phone.sql`, all safe to run again). The rules about who can read and write what are enforced there with row
level security, not only in the app.

**On one phone only.** An account with an email and a PIN that never leaves the
device, for someone who does not want anything online. No managers in this mode.

Every person gets **their own local database** (`smart_agri_data_<id>`; for an online
cooperative the id includes the person, not only the cooperative). Tagging rows with
an owner id would mean one missed `where` clause leaks another group's workers into
your screens; a separate database cannot leak by omission, including when two people
share a phone.

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

**Payments post to the ledger only when recorded as paid.** Pending and approved
payments are intentions, and intentions do not move balances. The "paid" step is a
human confirming that money genuinely changed hands outside the app, which is the
difference between an outstanding figure you can act on and one you have to
double-check. Record it early and the ledger will claim a farmer was paid when they
were not.

**The payment list is meant to be exported.** Build it from who is owed, check the
amounts, export it as CSV, then take that to the pay table or the mobile money agent.
Come back and record what you actually paid.

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

**Online accounts** sign in with a phone number and a password; an email address
is optional. Not every manager has an email, and SMS costs money, so the app turns
the phone number into a private sign-in name on Supabase's email sign-in (set
`VITE_PHONE_LOGIN_DOMAIN` to a domain you own; "Confirm email" must be off). Nothing
is ever sent to it. A forgotten password is set again inside the app with a code: a
manager uses their group's manager code, the owner uses a recovery code shown once at
sign-up (`supabase/phone.sql`). Accounts created with an email before this still sign
in with that email. The app never stores the password. A signed-in phone opens straight into its own copy with no signal, and
checks its membership with the server when it can: a manager the owner removed is
signed out and their copy is deleted from the phone.

**Phone-only accounts** use a PIN. PINs are never stored. Each account keeps a
PBKDF2-SHA256 hash at 150,000 iterations with a per-account salt, so a four-digit PIN
is slow to brute-force off a stolen device rather than instant. Sign-in failures say
the same thing whether the email or the PIN was wrong. Recovery uses a code issued
once at sign-up; using a code spends it and issues a new one.

## Known limits

- **Work-day photos travel inside the records.** They are kept small (about 50 KB),
  but a manager's first sync on a new phone downloads all of them. Moving photos to
  Supabase Storage and syncing a link is the next step if this gets heavy.
- **One cooperative per person.** Joining a second cooperative with another code is
  not supported; the app opens the first one.
- **Phone-only accounts do not sync**, and anyone with the device and the PIN is in.
- **Kinyarwanda covers the interface**, not user-entered data: worker names,
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
