import { devSandboxEnabled, isDevSandboxConnection, isDevSandboxDate, PUBLIC_SANDBOX_MERCHANT } from "./dev-sandbox";
import { decryptKeys } from "./payment-keys";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { lockRemaining } from "@/lib/booking/projection";
import { isFunded } from "@/lib/booking/rules";
import type { Registration } from "@/lib/booking/types";
import {
  allocationOnComplete,
  applyItn,
  type PaymentRecord,
} from "@/lib/payments/ledger";
import {
  checkoutFields,
  confirmWithPayfast,
  parseItnBody,
  resolvePayfastIps,
  validateItn,
  type MerchantCredentials,
} from "@/lib/payments/payfast";
import { adminDb } from "./admin";
import { audit } from "./audit";
import { rosterName, expireEventHolds, expireHold } from "./booking";
import { readEventTx, writeEventTx } from "./context";
import { badRequest, conflict, forbidden, notFound } from "./errors";
import { settlementFor } from "@/lib/booking/settlement";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3410";
}

/** Server-calculated checkout form for an unexpired hold. */
export async function checkoutForm(registrationId: string, token: string) {
  await expireHold(registrationId);
  const db = adminDb();
  const reg = (await db.doc(`registrations/${registrationId}`).get()).data() as
    (Registration & { accessTokenHash?: string }) | undefined;
  if (!reg) throw notFound("Booking not found");
  if (reg.accessTokenHash !== sha(token)) throw forbidden();
  if (
    reg.attendance !== "held" ||
    !reg.holdExpiresAt ||
    new Date(reg.holdExpiresAt).getTime() <= Date.now()
  ) {
    throw conflict(
      "This checkout has expired. Return to the date page to try again.",
      "expired",
    );
  }
  const payment = (
    await db.doc(`payments/${registrationId}`).get()
  ).data() as PaymentRecord;
  const event = (await db.doc(`events/${reg.eventId}`).get()).data()!;
  const creds = await merchantCredentials(reg.workspaceId, reg.eventId);
  const devSandbox = devSandboxEnabled() && creds.sandbox;
  const baseUrl = new URL(appBaseUrl());
  if (devSandbox) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)) throw forbidden("DEV ONLY — a loopback return URL is required.");
    // PayFast rejects URLs containing 'localhost'; the browser can return to loopback.
    baseUrl.hostname = "127.0.0.1";
  }
  const base = baseUrl.origin;
  const back = `${base}/booking/${registrationId}?t=${encodeURIComponent(token)}`;
  const returnNonce = devSandbox ? randomBytes(32).toString("hex") : null;
  if (returnNonce) await db.doc(`payments/${registrationId}`).update({
    devSandboxCheckout: true,
    devMerchantId: creds.merchantId,
    devReturnHash: sha(returnNonce),
    devReturnExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  return checkoutFields(creds, {
    paymentId: payment.id,
    amountCents: payment.amountCents,
    itemName: `${event.title} ${event.date}`,
    itemDescription: `${event.venue}`,
    firstName: reg.displayName,
    email: reg.contactEmail,
    returnUrl: returnNonce ? `${back}&dev_return=${returnNonce}` : back,
    cancelUrl: back,
    notifyUrl: devSandbox ? undefined : `${base}/api/payfast/itn`,
    registrationId,
  });
}

let ipCache: { at: number; ips: string[] } | undefined;
async function payfastIps(): Promise<string[]> {
  if (!ipCache || Date.now() - ipCache.at > 10 * 60_000)
    ipCache = { at: Date.now(), ips: await resolvePayfastIps() };
  return ipCache.ips;
}

export type ItnOutcome = { status: number; effect: string };

/**
 * Instant Transaction Notification. Validation (including the network post-back) happens
 * outside the transaction; the transaction only applies the verified result, idempotently.
 */
export async function handleItn(
  rawBody: string,
  sourceIp: string | null,
  now = new Date(),
): Promise<ItnOutcome> {
  const db = adminDb();
  const fields = parseItnBody(rawBody);
  const mPaymentId = fields.find(([k]) => k === "m_payment_id")?.[1];
  const logRef = db.collection("itnLog").doc(sha(rawBody).slice(0, 40));
  await logRef.set(
    { receivedAt: now.toISOString(), sourceIp, mPaymentId: mPaymentId ?? null },
    { merge: true },
  );
  if (!mPaymentId) return { status: 400, effect: "malformed" };

  const paymentSnap = await db.doc(`payments/${mPaymentId}`).get();
  if (!paymentSnap.exists) {
    await raiseException(
      null,
      mPaymentId,
      "Notification for unknown checkout reference",
    );
    return { status: 200, effect: "unknown_payment" };
  }
  const payment = paymentSnap.data() as PaymentRecord;
  const creds = await merchantCredentials(payment.workspaceId, payment.eventId);
  const trustProxy =
    process.env.PAYFAST_SKIP_SOURCE_CHECK === "true" && creds.sandbox;
  const check = await validateItn(fields, {
    creds,
    expectedAmountCents: payment.amountCents,
    sourceIp: trustProxy ? "sandbox" : sourceIp,
    allowedIps: trustProxy ? ["sandbox"] : await payfastIps(),
    confirmWithServer: (s) => confirmWithPayfast(s, creds.sandbox),
  });
  await logRef.update({ validation: check.ok ? "ok" : check.reason });
  if (!check.ok) {
    await raiseException(
      payment.workspaceId,
      mPaymentId,
      `Rejected notification: ${check.reason}`,
    );
    return { status: 400, effect: check.reason };
  }
  const effect = await applyVerifiedItn(check.payload, now);
  return { status: 200, effect };
}

/** Exported for emulator tests, which exercise ordering without network validation. */
export async function applyVerifiedItn(
  itn: import("@/lib/payments/payfast").ItnPayload,
  now = new Date(),
): Promise<string> {
  const db = adminDb();
  const paymentRef = db.doc(`payments/${itn.mPaymentId}`);
  const initial = (await paymentRef.get()).data() as PaymentRecord;
  if (!initial) throw notFound("Payment not found");
  await expireEventHolds(initial.eventId, now);
  return db.runTransaction(async (tx) => {
    const payment = (await tx.get(paymentRef)).data() as PaymentRecord;
    const regRef = db.doc(`registrations/${payment.registrationId}`);
    const reg = (await tx.get(regRef)).data() as Registration;
    const ctx = await readEventTx(tx, reg.eventId);

    const { payment: next, effect } = applyItn(payment, itn, now.toISOString());
    if (effect === "duplicate") return effect;
    tx.set(paymentRef, next);
    if (effect === "exception") {
      raiseExceptionTx(
        tx,
        payment.workspaceId,
        payment.id,
        next.exceptions.at(-1)!,
      );
      return effect;
    }
    if (next.state !== "complete" || payment.state === "complete") {
      if (
        (next.state === "failed" || next.state === "cancelled") &&
        reg.payment === "pending"
      )
        tx.update(regRef, { payment: "unpaid" });
      return effect;
    }

    const lock = ctx.locks[reg.poolId]!;
    const remaining = lockRemaining(ctx.event, lock, reg.poolId, now, reg.id);
    const frozen = ctx.event.status === "cancelled";
    const decision = frozen
      ? "late_no_capacity"
      : allocationOnComplete(reg.attendance, reg.holdExpiresAt, remaining, now);
    const paidAt = now.toISOString();
    switch (decision) {
      case "confirm":
      case "late_allocate":
        tx.update(regRef, {
          attendance: "active",
          payment: "paid_online",
          paidAt,
          holdExpiresAt: null,
        });
        lock.places[reg.id] = {
          state: "active",
          rosterName: rosterName(reg),
          since: paidAt,
        };
        if (reg.offerId)
          tx.update(db.doc(`waitlist/${reg.offerId}`), { status: "accepted" });
        writeEventTx(tx, ctx, now, [reg.poolId]);
        break;
      case "already_confirmed":
        if (isFunded(reg) && reg.payment !== "paid_online") {
          // Already funded another way (cash, transfer, waiver): this is a double payment.
          raiseExceptionTx(
            tx,
            payment.workspaceId,
            payment.id,
            `PayFast payment received for a place already marked ${reg.payment}`,
          );
        } else {
          tx.update(regRef, { payment: "paid_online", paidAt });
        }
        break;
      case "late_no_capacity":
      case "settle_withdrawn":
        tx.update(regRef, {
          attendance: reg.attendance === "withdrawn" ? "withdrawn" : "released",
          payment: "late_unallocated",
          ...settlementFor({
            ...reg,
            payment: "late_unallocated",
            amountCents: payment.amountCents,
          }),
          paidAt,
        });
        delete lock.places[reg.id];
        writeEventTx(tx, ctx, now, [reg.poolId]);
        raiseExceptionTx(
          tx,
          payment.workspaceId,
          payment.id,
          "Payment without a place: settle with the organiser",
        );
        break;
    }
    return `${effect}:${decision}`;
  });
}

function raiseExceptionTx(
  tx: FirebaseFirestore.Transaction,
  workspaceId: string,
  paymentId: string,
  message: string,
) {
  const ref = adminDb().collection("paymentExceptions").doc();
  tx.set(ref, {
    id: ref.id,
    workspaceId,
    paymentId,
    message,
    resolved: false,
    createdAt: new Date().toISOString(),
  });
}

async function raiseException(
  workspaceId: string | null,
  paymentId: string,
  message: string,
) {
  const ref = adminDb().collection("paymentExceptions").doc();
  await ref.set({
    id: ref.id,
    workspaceId,
    paymentId,
    message,
    resolved: false,
    createdAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Organiser-recorded money (distinguishable from PayFast receipts)

export const manualPaymentInput = z.object({
  method: z.enum(["external_transfer", "cash", "waiver"]),
  amountCents: z.number().int().nonnegative(),
  note: z.string().max(300).default(""),
});

export async function recordManualPayment(
  registrationId: string,
  input: z.infer<typeof manualPaymentInput>,
  actorUid: string,
  now = new Date(),
) {
  const db = adminDb();
  await expireHold(registrationId, now);
  const regRef = db.doc(`registrations/${registrationId}`);
  await db.runTransaction(async (tx) => {
    const reg = (await tx.get(regRef)).data() as Registration | undefined;
    if (!reg) throw notFound();
    const ctx = await readEventTx(tx, reg.eventId);
    if (ctx.event.status === "cancelled" || !["active", "held"].includes(reg.attendance))
      throw conflict("This player no longer has a place.");
    if (input.method !== "waiver" && input.amountCents !== reg.amountCents)
      throw badRequest("Record the full player price.");
    if (isFunded(reg)) throw conflict("This place is already funded.");
    if (input.method === "waiver" && input.amountCents !== 0)
      throw badRequest("A waiver records no money.");
    const lock = ctx.locks[reg.poolId]!;
    if (reg.attendance !== "active") {
      if (lockRemaining(ctx.event, lock, reg.poolId, now, reg.id) <= 0)
        throw conflict("No place remains for this player.");
    }
    const id = `${registrationId}_${input.method}`;
    const payment: PaymentRecord = {
      id,
      workspaceId: reg.workspaceId,
      eventId: reg.eventId,
      registrationId,
      method: input.method,
      state: "complete",
      amountCents: input.amountCents,
      feeCents: 0,
      appliedNotifications: [],
      exceptions: [],
      recordedBy: actorUid,
      note: input.note,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    tx.create(db.doc(`payments/${id}`), payment);
    const status =
      input.method === "cash"
        ? "cash_received"
        : input.method === "waiver"
          ? "fee_waived"
          : "paid_externally";
    tx.update(regRef, {
      attendance: "active",
      payment: status,
      paidAt: now.toISOString(),
      holdExpiresAt: null,
    });
    lock.places[reg.id] = {
      state: "active",
      rosterName: rosterName(reg),
      since: now.toISOString(),
    };
    if (reg.offerId) tx.update(db.doc(`waitlist/${reg.offerId}`), { status: "accepted" });
    writeEventTx(tx, ctx, now, [reg.poolId]);
    audit(tx, reg.workspaceId, {
      actorUid,
      action: `payment.manual.${input.method}`,
      target: registrationId,
      detail: { amountCents: input.amountCents, note: input.note },
    });
  });
}

export async function settle(registrationId: string, actorUid: string) {
  const db = adminDb();
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`registrations/${registrationId}`);
    const reg = (await tx.get(ref)).data() as Registration | undefined;
    if (!reg) throw notFound();
    if (reg.settlement === "settled") return;
    if (reg.settlement !== "due") throw conflict("No money is due to settle.");
    tx.update(ref, {
      settlement: "settled",
      settledAt: new Date().toISOString(),
    });
    audit(tx, reg.workspaceId, {
      actorUid,
      action: "settlement.complete",
      target: reg.id,
    });
  });
}

export async function merchantCredentials(
  workspaceId: string,
  eventId?: string,
): Promise<MerchantCredentials> {
  if (eventId) {
    const event = (await adminDb().doc(`events/${eventId}`).get()).data();
    if (event?.workspaceId === workspaceId && isDevSandboxDate(event)) return PUBLIC_SANDBOX_MERCHANT;
  }
  const cfg = (await adminDb().doc(`merchants/${workspaceId}`).get()).data();
  if (!cfg?.encrypted)
    throw conflict("Connect PayFast in Settings → Payments.");
  return {
    ...decryptKeys<Omit<MerchantCredentials, "sandbox">>(
      cfg.encrypted,
      workspaceId,
    ),
    sandbox: cfg.sandbox === true,
  };
}


/** DEV ONLY: a browser return is not payment proof. This bypass is limited to demo emulators. */
export async function confirmDevSandboxReturn(registrationId: string, token: string, nonce: string) {
  if (!devSandboxEnabled()) throw forbidden("DEV ONLY — return confirmation is disabled.");
  const db = adminDb();
  const reg = (await db.doc(`registrations/${registrationId}`).get()).data();
  if (!reg || reg.accessTokenHash !== sha(token)) throw forbidden();
  const event = (await db.doc(`events/${reg.eventId}`).get()).data();
  const ws = event ? (await db.doc(`workspaces/${reg.workspaceId}`).get()).data() : null;
  if (!event || (!isDevSandboxDate(event) && !isDevSandboxConnection(ws?.merchant))) throw forbidden("DEV ONLY — this is not a sandbox date.");
  const creds = await merchantCredentials(reg.workspaceId, reg.eventId);
  if (!creds.sandbox) throw forbidden();
  const paymentRef = db.doc(`payments/${registrationId}`);
  const payment = (await paymentRef.get()).data();
  const expected = Buffer.from(payment?.devReturnHash ?? "", "hex");
  if (!/^[a-f0-9]{64}$/.test(nonce) || expected.length !== 32 || !timingSafeEqual(expected, Buffer.from(sha(nonce), "hex"))) throw forbidden("Use the return link issued by checkout.");
  if (!payment?.devSandboxCheckout || payment.devMerchantId !== creds.merchantId || payment.method !== "payfast" || payment.registrationId !== registrationId || payment.eventId !== reg.eventId || payment.workspaceId !== reg.workspaceId) throw forbidden();
  const expiresAt = new Date(payment.devReturnExpiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw conflict("DEV ONLY — sandbox return link expired. Start checkout again.");
  const effect = await applyVerifiedItn({
    mPaymentId: registrationId, pfPaymentId: `dev-return-${registrationId}`, status: "COMPLETE",
    grossCents: payment.amountCents, feeCents: 0, netCents: payment.amountCents, merchantId: creds.merchantId,
  });
  await paymentRef.update({ devReturnConfirmed: true });
  return { devOnly: true, effect };
}
