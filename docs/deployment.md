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
