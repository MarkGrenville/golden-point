# Golden Point

A free web app for running a weekly padel group: who's in, who's paid, who's waiting, and the
Americano / Mexicano on the night. Open source (MIT). Built by Mark Grenville (Web Footprint).

This repo started as a bigger app (bookings, refunds, court recommendations, a background sweep). Mark
cut it back on 12 Nov 2026. This file is the product brief: where the code and this file disagree, this
file wins.

## Who it's for

The organiser of a weekly "flexi league" (Mark's Thursday group: different people each week, courts
booked by one person, money chased on WhatsApp) and the players who join. Playtomic already runs
tournaments; this is about the weekly admin: who's playing, who's paid, who's on the waiting list.

## The rule: free, and no sign-up unless it's really needed

Everything a player or a one-off organiser does works **without an account**:

- **Run a tournament:** Americano or Mexicano, or just "match us up" (random or balanced pairs for a
  social round), scores entered on any phone, a live link everyone can open. Saved on the device.
- **Join a date:** open the organiser's link, type your name, and either pay with PayFast (when the
  organiser has connected it) or pick "I'll pay cash / EFT". No account.
- **See the list:** everyone with the link sees who's in, who's paid, who's waiting and the scores.
  Players' contact details are never shown.

**Signing in (Google or email link)** is only to make life easier later, and never forced:
- save your group's player names for next week;
- keep tournaments and dates online instead of on one phone;
- mark people as paid (organiser);
- connect your own PayFast so players pay you directly (organiser).

A small, dismissible bar at the bottom offers it at the moment it would help ("Want to keep these names
for next week? Sign in and we'll save them."). Never a wall, never a pop-up that blocks the page.

## What stays, what goes

**Keep:** the tournament engine (`src/lib/tournament`, its tests), local sessions, the live scoreboard
(`/s/<id>`), group links and dates (`/g/<slug>`, `/e/<id>`), joining without an account, PayFast checkout
and ITN validation, the **waiting list** (first come, first served; a place that opens goes to the next
person, who is told on the link), **withdrawals** (a player can drop out) and **cancelling a date** (the
organiser can call it off; everyone on the link sees it).

**Remove:** refunds and the PayFast refund API, the refund ledger states, withdrawal policies and cut-offs
beyond a single "drop out before <time>" setting, court recommendations, Playtomic notes, the scheduled
sweep and job queue (check hold expiry when a page or payment is read instead), anything a weekly group
doesn't need. Delete the code and its tests; don't leave it switched off.

**Money back is done in person.** If someone who paid drops out, or a date is cancelled, the app shows
"R<amount> to settle with <organiser>" and the organiser ticks "settled" when it's sorted (cash, EFT,
credit for next week). The app never moves money back.

## Payments: the organiser's own PayFast

- In **Settings → Payments** a signed-in organiser pastes their own PayFast merchant ID, merchant key
  and passphrase, with a link to PayFast's sign-up and a plain explanation of where to find each one.
  A "Test with PayFast sandbox" switch uses the public sandbox merchant.
- Players pay the organiser directly. Golden Point never holds money and charges no fee.
- Keys are stored **encrypted** (AES-256-GCM, the data key from a server secret, `GP_KEYS_SECRET`),
  in a collection no client can read; never logged, never sent to the browser after saving (show
  "connected, ends in …4f2a").
- ITN marks the place paid automatically. The organiser can also tick "paid" by hand for cash or EFT.
- **SnapScan / Zapper:** the organiser can add their own SnapScan or Zapper payment link (or QR image);
  players see it as an option and the organiser ticks them off by hand. No API integration in v1.

## Footer

On every page: "Free and open source · Powered by Web Footprint · Need an app or a change? Get in touch"
linking to https://webfootprint.co.za and the GitHub repo.

## Look: "clubhouse scoreboard"

Court blue, ball yellow, chalk white; big numbers readable on a phone in the sun; one clear action per
screen. Mobile first.

## Tech

Next.js on Firebase App Hosting, Firebase Auth (Google, email link), Firestore. Deploy to your own Firebase project (register a web app and use its public configuration). Region
europe-west4. ZAR in integer cents, `Africa/Johannesburg`. Local development on the emulators
(`demo-golden-point`), never the live project. Keep `npm test` green and add tests for
what you add (encryption round trip, keys never in a client read, mark paid, settle, waiting list).

## Never

- Copy, print or commit a real PayFast key, the `GP_KEYS_SECRET`, or any credential file.
- Show players' contact details on a public page.
- Import real WhatsApp messages or real people's names into the repo or the demo data. Demo names are
  made up.
