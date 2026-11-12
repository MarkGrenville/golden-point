# Deployment

The app targets Firebase App Hosting, Auth (Google and email links), and Firestore in europe-west4. Use your own Firebase project for production. Local work uses demo projects and emulators only.

Configure the registered web app's public Firebase configuration and `APP_BASE_URL` in App Hosting. Authorise the hosted domain in Firebase Auth. Enable Google and email-link sign-in. Configure Firestore using `firestore.rules` and `firestore.indexes.json`.

Bind `GP_KEYS_SECRET` to the server runtime using Secret Manager (`gp-keys-secret` in `apphosting.yaml`). Its value must be 32 random bytes encoded as 64 hex characters. Never log, commit or expose it through a `NEXT_PUBLIC_` variable. Back it up securely: existing encrypted merchant credentials require the same key to decrypt. Rotating it requires re-encrypting credentials or reconnecting merchants.

For local emulator development, keep a separate development-only `GP_KEYS_SECRET` in the ignored `.env.development.local` file (64 hexadecimal characters). Do not reuse a production key. A missing encryption key prevents PayFast credentials from being saved; SnapScan / Zapper links work independently.

Organisers connect PayFast from their organiser group → Settings → Payments (`/admin/w/<group-id>/settings/payments`). Merchant ID, merchant key and passphrase are encrypted with AES-256-GCM; ciphertext is bound to the workspace. Firestore rules deny all client access to merchants, including owners. Only connection status and the key's last four characters are returned to the organiser. The sandbox switch uses the organiser’s entered sandbox credentials, encrypted in the same way as live credentials, and sends checkout to PayFast’s sandbox. The separate DEV ONLY date option still uses the public test merchant. No merchant credentials are seeded.

In local development, both connected sandbox accounts and guest sandbox dates use the DEV ONLY return simulation because PayFast cannot reach the local ITN endpoint. The booking’s private token, expiring checkout nonce and merchant must match. Production disables this path and requires verified ITNs, including for sandbox connections.

PayFast's ITN URL is `${APP_BASE_URL}/api/payfast/itn`. ITNs verify signature, amount, merchant, source IP and PayFast post-back before changing a place. Repeated notifications are idempotent. A late payment only gets a place when capacity remains; otherwise the app records money to settle in person.

No Cloud Functions, Scheduler or queue is required. Date, place and checkout reads expire old holds and advance the waiting list. An idle app does no background work; waiting players see offers when links are opened. If upgrading a previously deployed installation, remove its old scheduled functions/triggers before enabling this version. Existing production data needs an explicit migration to player limits, settlement fields and encrypted merchants; this change does not mutate a live database.

Before release, run unit tests, typecheck, emulator integration tests and the production build. Check a guest cash/EFT join, an organiser payment tick, a PayFast sandbox checkout, a paid drop-out and settlement, cancellation, FIFO offers/expiry, and public pages with no contact details. Run `npm run test:emulator` for isolated, disposable emulators (`demo-golden-point-test`, Firestore 8280, Auth 9510). They never import, export or clear the development project; the dev stack can remain running.

Never deploy or seed against the live project during local development.

Guest tournaments publish public scoreboards through `/api/scoreboards/<id>`, without Firebase sign-in. A random publishing token is stored on the organiser’s device; only its SHA-256 hash is kept in the server-only `guestScoreboards` collection. The spectator URL contains no token. Payloads are limited to public scoreboard fields, and stale revisions cannot replace newer scores. Existing Firestore rules allow anonymous scoreboard reads and deny client access to publishing-token hashes.

## Deployment configuration and verification

Keep `.firebaserc` pointing at the demo project for local work. Always name your own production project explicitly in deploy commands. The Firebase web API key is public client configuration and belongs in the `NEXT_PUBLIC_FIREBASE_API_KEY` placeholder in `apphosting.yaml`. PayFast credentials and `GP_KEYS_SECRET` must remain private; bind `gp-keys-secret` through Secret Manager for RUNTIME only, and never replace it during a routine rollout.

Create the App Hosting backend and the Standard Firestore database in `europe-west4`. Authorise the backend hostname under Firebase Authentication settings. Enable email-link sign-in and Google sign-in in the Firebase console, selecting a support email for Google. Configure `APP_BASE_URL` with the assigned HTTPS backend origin so payment return and ITN URLs point to the deployed app.

Grant the App Hosting runtime service account `roles/datastore.user`, plus access to `gp-keys-secret`. Never upload a service-account credential file. Source uploads exclude environment files, emulator data, logs, local tooling and Firebase web-config exports.

After creating the backend (using `golden-point-web` to match `firebase.json`), deploy local source with:

```sh
firebase deploy --only firestore,apphosting --project YOUR_PROJECT_ID --non-interactive
```

A completed source upload is not a completed rollout: wait for App Hosting to report success. Confirm that all six composite indexes are READY and the `rateLimits.expiresAt` TTL policy is ACTIVE. Check the homepage, sign-in and tournament creation pages; a missing group should return 404 through the server Firestore path. Anonymous client reads of merchant data must return 403, and a request to the signed-in API without credentials must return 401.

On a phone, verify a Mexicano, the footer, a guest cash registration with fictional data, and cancellation. Exercise Google and email-link sign-in end to end before calling those flows verified. Keep real player records and operational rollout logs out of this repository.
