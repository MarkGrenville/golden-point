# Golden Point

A free, open-source web app for running a weekly padel group: who's in, who's paid,
who's waiting, and the Americano or Mexicano on the night. Built by
[Mark Grenville / Web Footprint](https://webfootprint.co.za). Licensed under [MIT](LICENSE).

## Free, with no compulsory sign-up

Players and one-off organisers do not need an account. Run a tournament, make random
or balanced pairs for a social round, create a date, join through a shared link, and
follow the list or live scores on any phone. Local tournaments stay on your device;
you can publish a live scoreboard with a spectator link and QR code.

Signing in with Google or an email link is optional: it helps keep groups, player
names and tournaments for next week, and lets an organiser connect their own PayFast.
The sign-in offer is small and dismissible; it never blocks play.

- **Weekly dates:** player limits, first-come waiting lists, withdrawals and cancellation.
  Keep your private booking or organiser link; share the separate public player link.
  Public pages show names and payment status, never contact details.
- **Payments:** PayFast pays the organiser directly. Golden Point holds no money and
  charges no fee. Cash, EFT and an organiser's SnapScan or Zapper link can be marked paid
  by hand. Merchant credentials are encrypted on the server with AES-256-GCM.
- **Settlements:** paid withdrawals and cancellations show money to settle with the
  organiser. Resolve it in person, then tick settled. The app never moves money back.
- **Social rounds:** open `/match`, enter 4–32 names and choose random or balanced pairs.
  For balanced games, list players from strongest to newest: nearby levels share a court,
  stronger and weaker partners mix. Choose your courts, shuffle again, and see who sits out.
  Rests are drawn at random on each shuffle; names and the draw stay on your device.
- **On court:** Americano, Mexicano, local sessions and shared live scoreboards.
  Waiting-list offers and holds expire when pages or payments are read; no scheduler is needed.

The app is free; hosting your own copy and using a payment provider may incur their charges.
See [AGENTS.md](AGENTS.md) for the product brief.

## Run locally on Firebase emulators

Use Node.js 24.12 or newer, Java 21 or newer, and the
[Firebase CLI](https://firebase.google.com/docs/cli). The development project is always
`demo-golden-point`; no real Firebase credentials or cloud project are needed.

```sh
npm ci
npm install -g firebase-tools
```

Create an ignored `.env.development.local` file with these emulator-only values
(the public copy's `.env.example` is a placeholder reference, not a ready-to-run config):

```dotenv
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-golden-point
NEXT_PUBLIC_FIREBASE_API_KEY=demo-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost
NEXT_PUBLIC_FIREBASE_APP_ID=demo-app
NEXT_PUBLIC_USE_EMULATORS=true
NEXT_PUBLIC_AUTH_EMULATOR_URL=http://127.0.0.1:9410
FIRESTORE_EMULATOR_HOST=127.0.0.1:8180
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9410
GCLOUD_PROJECT=demo-golden-point
APP_BASE_URL=http://localhost:3410
```

To test saving encrypted merchant settings, generate a separate local key directly into
that ignored file. Run this once; keep the value private and never reuse a production key:

```sh
node --input-type=module -e 'import { appendFileSync } from "node:fs"; import { randomBytes } from "node:crypto"; appendFileSync(".env.development.local", "\nGP_KEYS_SECRET=" + randomBytes(32).toString("hex") + "\n");'
```

Start the emulators in one terminal and Next.js in another:

```sh
npm run emulators
```

```sh
npm run dev
```

Open **http://localhost:3410**. The emulator UI is **http://localhost:4410**;
Firestore uses port **8180**, Auth **9410**. The emulator script saves local data in
`.emulator-data` on exit and imports it next time. The first run starts with empty data.
If using a process manager, let it own these processes instead of starting duplicates.

Optionally run `npm run seed` after the emulators start. It creates fictional data at
`/g/thursday-golden-point` and `/e/demo-open`. Use the Auth emulator UI or the app's
email-link flow to sign in as `organiser@example.com`; email sign-in links appear in
the Auth emulator terminal. You can also create your own date at `/date/new` without signing in.

For local PayFast testing, create a paid date and choose **DEV ONLY — Use PayFast public
sandbox (10000100)**. It uses PayFast's published shared test merchant; no real money
changes hands. PayFast cannot send an ITN to your local machine, so returning from
sandbox checkout simulates confirmation using an expiring private nonce. This is
labelled simulated and is restricted to local development emulators. Production
requires verified ITNs, including for connected sandbox accounts.

## Checks

```sh
npm test
npm run lint
npm run test:emulator
npm run build
```

Integration tests start their own disposable emulators for `demo-golden-point-test`
using `firebase.test.json` (Firestore **8280**, Auth **9510**). They do not import,
export or clear development data, and can run alongside the development emulators.
The build uses your local development config only when you supply it explicitly;
for a local build check, copy the emulator variables above into ignored `.env.local`.
Do not carry emulator variables into a deployed build.

## Deploy your own copy to Firebase

1. Create your own Firebase project, enable billing on the **Blaze** plan, and register
   a web app. Create a Firestore database in **europe-west4**, and enable Authentication
   with Google and Email/Password → email-link sign-in. Your Firebase web configuration
   comes from Project settings → Your apps; this repository does not supply a live project.
2. In `apphosting.yaml`, replace the `APP_BASE_URL`, auth domain, project ID, app ID
   and Firebase web API key placeholders with your own values. Use the HTTPS backend
   URL assigned in step 4;
   update it and roll out again once that URL is known. Leave all emulator variables unset
   in App Hosting. Keep `.firebaserc` pointing at the safe demo project for local work.
3. Sign in to the CLI and deploy the Firestore rules and indexes to your explicitly
   selected project. Replace `YOUR_PROJECT_ID` in every command below:

   ```sh
   firebase login
   firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
   firebase apphosting:secrets:set gp-keys-secret --project YOUR_PROJECT_ID
   ```

   Enter a securely generated **32-byte key encoded as 64 hex characters**. Store a
   secure backup: existing encrypted PayFast credentials need that same key to decrypt.
   Never commit it or expose it in a `NEXT_PUBLIC_` variable.
4. Put your copy in your own GitHub repository. In Firebase console → App Hosting,
   create a backend, choose **europe-west4**, connect that repository, select the live
   branch and use `/` as the app root. Use `golden-point-web` as the backend ID to match
   `firebase.json`, or update that ID to your choice. Grant the backend access to the
   encryption secret, using the console or CLI:

   ```sh
   firebase apphosting:secrets:grantaccess gp-keys-secret --backend golden-point-web --project YOUR_PROJECT_ID
   ```

   Start a rollout after configuring the secret and `apphosting.yaml`. Future pushes
   to your selected live branch can trigger automatic rollouts. This is Firebase
   **App Hosting** for Next.js; deploying Firestore alone does not deploy the web app.
5. Add your hosted domain (and any custom domain) to Authentication → Settings →
   Authorized domains. Check Google and email-link sign-in on the deployed site.
   Set `APP_BASE_URL` to that same public HTTPS origin and roll out the final configuration.
6. Sign in, open an organiser group → **Settings → Payments**, and connect your own
   PayFast merchant ID, key and passphrase. Players pay that merchant directly.
   The ITN endpoint is `https://YOUR_DOMAIN/api/payfast/itn`; checkout supplies it to
   PayFast. Verify a sandbox payment on the deployed site before using live credentials.
   SnapScan and Zapper links are optional and are reconciled manually.

Set billing alerts and review the instance limits in `apphosting.yaml`; alerts are not
a spending cap. App Hosting supplies the server's Firebase credentials through its
runtime identity; do not upload a service-account JSON file.

See [deployment notes](docs/deployment.md) for payment verification and release checks,
and Firebase's [App Hosting setup](https://firebase.google.com/docs/app-hosting/get-started)
and [configuration guide](https://firebase.google.com/docs/app-hosting/configure) for
backend and secret management.

## Code map

- `src/lib/tournament`: tournament engine and unit tests.
- `src/lib/booking`: capacity, waiting lists, public views and settlement.
- `src/lib/payments`: PayFast signatures, ITN verification and payment state.
- `src/server`: organiser actions, encrypted settings and transactional updates.
- `tests`: emulator integration and Firestore security tests.

Free and open source · Powered by [Web Footprint](https://webfootprint.co.za) ·
[Need an app or a change? Get in touch](https://webfootprint.co.za)
