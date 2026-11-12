import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { lockRemaining } from "@/lib/booking/projection";
import {
  HOLD_MINUTES,
  nextEligibleWaiter,
  OFFER_MINUTES,
  registrationGate,
} from "@/lib/booking/rules";
import type { Registration, WaitlistEntry } from "@/lib/booking/types";
import type { PaymentRecord } from "@/lib/payments/ledger";
import { adminDb } from "./admin";
import { audit } from "./audit";
import type { Caller } from "./auth";
import { readEventTx, writeEventTx } from "./context";
import { badRequest, conflict, forbidden, notFound } from "./errors";
import { settlementFor } from "@/lib/booking/settlement";
import { isDevSandboxDate, isDevSandboxConnection } from "./dev-sandbox";
import { notify } from "./notifications";

export const holdInput = z.object({
  poolId: z.string().min(1),
  displayName: z.string().trim().min(1).max(40),
  alias: z.string().trim().max(40).optional(),
  showOnRoster: z.boolean().default(true),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(200)
    .optional()
    .default(""),
  paymentMethod: z.enum(["payfast", "manual"]).optional().default("manual"),
});
export type HoldInput = z.input<typeof holdInput>;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const regKeyId = (eventId: string, email: string) =>
  `${eventId}_${sha(email).slice(0, 32)}`;

export function rosterName(
  r: Pick<Registration, "showOnRoster" | "alias" | "displayName">,
) {
  return r.showOnRoster ? r.alias || r.displayName : "Player";
}

export interface HoldResult {
  registrationId: string;
  /** Present for guests; grants read access to this one booking's status page. */
  bookingToken: string;
  holdExpiresAt?: string;
  requiresPayment: boolean;
  resumed: boolean;
}

/**
 * Claim a place. Serialises on the pool lock document, so two people racing for the last
 * place cannot both succeed. Free events confirm immediately; paid ones hold for ten minutes.
 */
export async function createHold(
  eventId: string,
  input: HoldInput,
  caller: Caller | null,
  now = new Date(),
): Promise<HoldResult> {
  const db = adminDb();
  await expireEventHolds(eventId, now);
  const email = input.email ?? "";
  const keyRef = db.doc(
    `regKeys/${regKeyId(eventId, email || randomBytes(16).toString("hex"))}`,
  );
  const token = randomBytes(24).toString("base64url");

  return db.runTransaction(async (tx) => {
    const ctx = await readEventTx(tx, eventId);
    const keySnap = await tx.get(keyRef);
    const existingId = keySnap.data()?.registrationId as string | undefined;
    const existing = existingId
      ? ((await tx.get(db.doc(`registrations/${existingId}`))).data() as
          Registration | undefined)
      : undefined;

    const { event } = ctx;
    const gate = registrationGate(event, input.poolId, ctx.merchant, now);
    if (!gate.open) throw conflict(gate.reasons[0] ?? gate.label, "closed");

    if (existing) {
      const live =
        existing.attendance === "active" ||
        (existing.attendance === "held" &&
          new Date(existing.holdExpiresAt!).getTime() > now.getTime());
      if (existing.attendance === "active")
        throw conflict(
          "This email address already has a place on this date. Sign in to manage it.",
          "duplicate",
        );
      if (live) {
        if (!caller || existing.uid !== caller.uid)
          throw conflict("Use your existing private place link.");
        // Resume the same checkout instead of creating a second record for the same place.
        tx.update(db.doc(`registrations/${existing.id}`), {
          accessTokenHash: sha(token),
        });
        return {
          registrationId: existing.id,
          bookingToken: token,
          holdExpiresAt: existing.holdExpiresAt,
          requiresPayment: existing.attendance === "held",
          resumed: true,
        };
      }
    }

    const lock = ctx.locks[input.poolId]!;
    if (lockRemaining(event, lock, input.poolId, now) <= 0) {
      throw conflict("This time slot is full. Join the waiting list.", "full");
    }

    const id = db.collection("registrations").doc().id;
    const paid = event.priceCents > 0 && input.paymentMethod === "payfast";
    if (paid && ctx.merchant !== "verified")
      throw conflict("PayFast is not connected. Choose cash / EFT.");
    const holdExpiresAt = new Date(
      now.getTime() + HOLD_MINUTES * 60_000,
    ).toISOString();
    const reg: Registration & { accessTokenHash: string } = {
      id,
      eventId,
      workspaceId: event.workspaceId,
      poolId: input.poolId,
      displayName: input.displayName,
      alias: input.alias || undefined,
      showOnRoster: input.showOnRoster ?? true,
      contactEmail: email,
      uid:
        caller?.emailVerified && caller.email === email
          ? caller.uid
          : undefined,
      attendance: paid ? "held" : "active",
      payment: paid ? "pending" : event.priceCents ? "unpaid" : "fee_waived",
      settlement: "none",
      amountCents: event.priceCents,
      holdExpiresAt: paid ? holdExpiresAt : undefined,
      createdAt: now.toISOString(),
      paidAt: paid ? undefined : now.toISOString(),
      accessTokenHash: sha(token),
    };
    lock.places[id] = {
      state: paid ? "held" : "active",
      expiresAt: paid ? holdExpiresAt : undefined,
      rosterName: rosterName(reg),
      since: now.toISOString(),
    };
    tx.set(db.doc(`registrations/${id}`), reg);
    tx.set(keyRef, { registrationId: id, eventId });
    if (paid) {
      const payment: PaymentRecord = {
        id,
        workspaceId: event.workspaceId,
        eventId,
        registrationId: id,
        method: "payfast",
        state: "initiated",
        amountCents: event.priceCents,
        feeCents: 0,
        appliedNotifications: [],
        exceptions: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      tx.set(db.doc(`payments/${id}`), payment);
    }
    writeEventTx(tx, ctx, now, [input.poolId]);
    return {
      registrationId: id,
      bookingToken: token,
      holdExpiresAt: paid ? holdExpiresAt : undefined,
      requiresPayment: paid,
      resumed: false,
    };
  });
}

/** Release a hold whose expiry has passed. Safe to run any number of times. */
export async function expireHold(registrationId: string, now = new Date()) {
  const db = adminDb();
  const regRef = db.doc(`registrations/${registrationId}`);
  await db.runTransaction(async (tx) => {
    const reg = (await tx.get(regRef)).data() as Registration | undefined;
    if (!reg) return;
    const ctx = await readEventTx(tx, reg.eventId);
    if (
      reg.attendance !== "held" ||
      !reg.holdExpiresAt ||
      new Date(reg.holdExpiresAt).getTime() > now.getTime()
    )
      return;
    tx.update(regRef, { attendance: "released" });
    delete ctx.locks[reg.poolId]!.places[reg.id];
    writeEventTx(tx, ctx, now, [reg.poolId]);
    if (reg.offerId)
      tx.update(db.doc(`waitlist/${reg.offerId}`), { status: "expired" });
  });
  await maybeOfferVacancy(registrationId, now);
}

export async function bookingStatus(
  registrationId: string,
  token: string | null,
  caller: Caller | null,
) {
  await expireHold(registrationId);
  const snap = await adminDb().doc(`registrations/${registrationId}`).get();
  const reg = snap.data() as
    (Registration & { accessTokenHash?: string }) | undefined;
  if (!reg) throw notFound("Booking not found");
  const owner = caller && reg.uid === caller.uid;
  if (!owner && (!token || sha(token) !== reg.accessTokenHash))
    throw forbidden("This link does not grant access to that booking.");
  const { accessTokenHash: _hidden, ...visible } = reg;
  const ws = (
    await adminDb().doc(`workspaces/${reg.workspaceId}`).get()
  ).data();
  const event = (await adminDb().doc(`events/${reg.eventId}`).get()).data()!;
  const devSandbox = isDevSandboxDate(event) || isDevSandboxConnection(ws?.merchant);
  return {
    devSandbox,
    registration: visible,
    organiserName: ws?.name ?? "the organiser",
    paymentLink: ws?.paymentLink ?? null,
    payfastConnected: devSandbox || ws?.merchant?.status === "verified",
    canManage: true,
  };
}

/** Link guest bookings to a signed-in user who has proved control of the same email address. */
export async function claimBookings(caller: Caller) {
  if (!caller.email || !caller.emailVerified)
    throw forbidden("Verify your email address to claim bookings.");
  const db = adminDb();
  const snaps = await db
    .collection("registrations")
    .where("contactEmail", "==", caller.email)
    .get();
  let claimed = 0;
  const batch = db.batch();
  for (const doc of snaps.docs) {
    const reg = doc.data() as Registration;
    if (reg.uid && reg.uid !== caller.uid) continue;
    if (!reg.uid) {
      batch.update(doc.ref, { uid: caller.uid });
      claimed++;
    }
  }
  await batch.commit();
  return { claimed };
}

export async function myBookings(caller: Caller) {
  const snaps = await adminDb()
    .collection("registrations")
    .where("uid", "==", caller.uid)
    .get();
  const regs = snaps.docs.map((d) => {
    const { accessTokenHash: _h, ...r } = d.data() as Registration & {
      accessTokenHash?: string;
    };
    return r as Registration;
  });
  const events = await Promise.all(
    [...new Set(regs.map((r) => r.eventId))].map((id) =>
      adminDb().doc(`publicEvents/${id}`).get(),
    ),
  );
  return {
    registrations: regs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    events: events.map((e) => e.data()).filter(Boolean),
  };
}

/**
 * Player drops out using their private link or signed-in identity.
 */
export async function withdraw(
  registrationId: string,
  caller: Caller | null,
  now = new Date(),
  token?: string | null,
) {
  const db = adminDb();
  const regRef = db.doc(`registrations/${registrationId}`);
  const result = await db.runTransaction(async (tx) => {
    const reg = (await tx.get(regRef)).data() as Registration | undefined;
    if (!reg) throw notFound("Booking not found");
    const hash = (reg as Registration & { accessTokenHash?: string })
      .accessTokenHash;
    if ((!caller || reg.uid !== caller.uid) && (!token || sha(token) !== hash))
      throw forbidden("Use your private place link to drop out.");
    const ctx = await readEventTx(tx, reg.eventId);
    if (reg.attendance !== "active" && reg.attendance !== "held")
      throw conflict("This booking is not active.");
    if (
      ctx.event.dropOutBefore &&
      now.getTime() >= new Date(ctx.event.dropOutBefore).getTime()
    )
      throw conflict(
        "The drop-out deadline has passed. Contact the organiser.",
      );
    const outcome = settlementFor(reg);
    delete ctx.locks[reg.poolId]!.places[reg.id];
    tx.update(regRef, {
      attendance: "withdrawn",
      withdrawnAt: now.toISOString(),
      ...outcome,
    });
    writeEventTx(tx, ctx, now, [reg.poolId]);
    audit(tx, reg.workspaceId, {
      actorUid: caller?.uid ?? null,
      action: "registration.withdraw",
      target: reg.id,
      detail: { settlement: outcome.settlement },
    });
    return outcome;
  });
  await maybeOfferVacancy(registrationId, now);
  return result;
}

// ---------------------------------------------------------------------------
// Waiting list

export const waitlistInput = z.object({
  displayName: z.string().trim().min(1).max(40),
  email: z.string().trim().toLowerCase().email().optional().default(""),
  poolIds: z.array(z.string()).min(1),
});

export async function joinWaitlist(
  eventId: string,
  input: z.infer<typeof waitlistInput>,
  caller: Caller | null,
  now = new Date(),
) {
  const db = adminDb();
  const email = input.email;
  const token = randomBytes(24).toString("base64url");
  const id = `${eventId}_${sha(email || token).slice(0, 24)}`;
  await db.runTransaction(async (tx) => {
    const ctx = await readEventTx(tx, eventId);
    if (!input.poolIds.every((id) => ctx.event.pools.some((p) => p.id === id)))
      throw badRequest("Unknown time slot.");
    if (
      !input.poolIds.some(
        (id) => registrationGate(ctx.event, id, ctx.merchant, now).open,
      )
    )
      throw conflict("This date is closed.");
    const ref = db.doc(`waitlist/${id}`);
    const existing = (await tx.get(ref)).data() as WaitlistEntry | undefined;
    if (
      existing &&
      (existing.status === "waiting" || existing.status === "offered")
    )
      throw conflict("You are already on the waiting list for this date.");
    const entry: WaitlistEntry = {
      id,
      eventId,
      displayName: input.displayName,
      contactEmail: email,
      uid:
        caller?.emailVerified && caller.email === email
          ? caller.uid
          : undefined,
      acceptablePoolIds: input.poolIds,
      status: "waiting",
      createdAt: now.toISOString(),
    };
    tx.set(ref, { ...entry, accessTokenHash: sha(token) });
    tx.set(
      db.doc(`publicEvents/${eventId}`),
      { waitingCount: FieldValue.increment(1) },
      { merge: true },
    );
  });
  return { id, token };
}

/**
 * After a place frees up, offer it to the first eligible waiter in queue order. The offer
 * reserves the place as a hold that expires with the offer.
 */
export async function maybeOfferVacancy(
  fromRegistrationId: string,
  now = new Date(),
) {
  const db = adminDb();
  const freed = (
    await db.doc(`registrations/${fromRegistrationId}`).get()
  ).data() as Registration | undefined;
  if (!freed) return;
  // Fill every open place; concurrent drop-outs can otherwise race for the same queue head.
  for (let attempt = 0; attempt < 32; attempt++) {
    const waiting = await db
      .collection("waitlist")
      .where("eventId", "==", freed.eventId)
      .where("status", "==", "waiting")
      .get();
    const candidate = nextEligibleWaiter(
      waiting.docs.map((d) => d.data() as WaitlistEntry),
      freed.poolId,
    );
    if (!candidate) return;
    const offered = await offerTo(candidate.id, freed.poolId, now);
    if (!offered) {
      const stillWaiting =
        (await db.doc(`waitlist/${candidate.id}`).get()).data()?.status ===
        "waiting";
      if (stillWaiting) return;
    }
  }
}

export async function offerTo(
  waitlistId: string,
  poolId: string,
  now = new Date(),
) {
  const db = adminDb();
  const ref = db.doc(`waitlist/${waitlistId}`);
  const token = randomBytes(24).toString("base64url");
  const offer = await db.runTransaction(async (tx) => {
    const entry = (await tx.get(ref)).data() as WaitlistEntry | undefined;
    if (!entry || entry.status !== "waiting") return null;
    const ctx = await readEventTx(tx, entry.eventId);
    const queue = await tx.get(
      db
        .collection("waitlist")
        .where("eventId", "==", entry.eventId)
        .where("status", "==", "waiting"),
    );
    if (
      nextEligibleWaiter(
        queue.docs.map((d) => d.data() as WaitlistEntry),
        poolId,
      )?.id !== entry.id
    )
      return null;
    if (!registrationGate(ctx.event, poolId, ctx.merchant, now).open)
      return null;
    if (lockRemaining(ctx.event, ctx.locks[poolId], poolId, now) <= 0)
      return null;
    const expiresAt = new Date(
      now.getTime() + OFFER_MINUTES * 60_000,
    ).toISOString();
    const regId = db.collection("registrations").doc().id;
    const reg: Registration = {
      id: regId,
      eventId: entry.eventId,
      workspaceId: ctx.event.workspaceId,
      poolId,
      displayName: entry.displayName,
      showOnRoster: true,
      contactEmail: entry.contactEmail,
      uid: entry.uid,
      attendance: "held",
      payment: ctx.event.priceCents > 0 ? "pending" : "fee_waived",
      settlement: "none",
      amountCents: ctx.event.priceCents,
      holdExpiresAt: expiresAt,
      createdAt: now.toISOString(),
      offerId: entry.id,
    };
    ctx.locks[poolId]!.places[regId] = {
      state: "held",
      expiresAt,
      rosterName: entry.displayName,
      since: now.toISOString(),
    };
    tx.set(db.doc(`registrations/${regId}`), {
      ...reg,
      accessTokenHash: sha(token),
    });
    tx.set(db.doc(`regKeys/${regKeyId(entry.eventId, entry.contactEmail)}`), {
      registrationId: regId,
      eventId: entry.eventId,
    });
    if (ctx.event.priceCents > 0) {
      tx.set(db.doc(`payments/${regId}`), {
        id: regId,
        workspaceId: ctx.event.workspaceId,
        eventId: entry.eventId,
        registrationId: regId,
        method: "payfast",
        state: "initiated",
        amountCents: ctx.event.priceCents,
        feeCents: 0,
        appliedNotifications: [],
        exceptions: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      } satisfies PaymentRecord);
    }
    tx.update(ref, {
      status: "offered",
      bookingToken: token,
      offer: { poolId, expiresAt, registrationId: regId },
    });
    tx.set(
      db.doc(`publicEvents/${entry.eventId}`),
      { waitingCount: FieldValue.increment(-1) },
      { merge: true },
    );
    writeEventTx(tx, ctx, now, [poolId]);
    return { entry, regId, expiresAt, event: ctx.event };
  });
  if (offer) {
    await notify({
      workspaceId: offer.event.workspaceId,
      uid: offer.entry.uid,
      email: offer.entry.contactEmail,
      kind: "waitlist_offer",
      title: `A place is available: ${offer.event.title}`,
      body: `Accept and pay before the offer expires at ${offer.expiresAt}.`,
      url: `/booking/${offer.regId}?t=${token}`,
    });
  }
  return offer;
}

/** Reads replace the old background worker. Expiry also advances the waiting list. */
export async function expireEventHolds(eventId: string, now = new Date()) {
  const held = await adminDb()
    .collection("registrations")
    .where("eventId", "==", eventId)
    .where("attendance", "==", "held")
    .get();
  for (const doc of held.docs) {
    const reg = doc.data() as Registration;
    if (
      reg.holdExpiresAt &&
      new Date(reg.holdExpiresAt).getTime() <= now.getTime()
    )
      await expireHold(reg.id, now);
  }
}
export async function waitingStatus(id: string, token: string) {
  const ref = adminDb().doc(`waitlist/${id}`);
  const before = (await ref.get()).data();
  if (!before || before.accessTokenHash !== sha(token)) throw forbidden();
  await expireEventHolds(before.eventId);
  const event = (await adminDb().doc(`events/${before.eventId}`).get()).data();
  if (event?.status === "cancelled")
    return { status: "cancelled", eventId: before.eventId, url: null };
  const entry = (await ref.get()).data()!;
  return {
    status: entry.status,
    eventId: entry.eventId,
    url:
      ["offered", "accepted"].includes(entry.status)
        ? `/booking/${entry.offer.registrationId}?t=${entry.bookingToken}`
        : null,
  };
}

/** A waiting player can accept their offered place and pay the organiser by hand. */
export async function acceptCash(
  registrationId: string,
  token: string,
  now = new Date(),
) {
  const db = adminDb();
  await expireHold(registrationId, now);
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`registrations/${registrationId}`);
    const reg = (await tx.get(ref)).data() as
      (Registration & { accessTokenHash?: string }) | undefined;
    if (!reg || reg.accessTokenHash !== sha(token)) throw forbidden();
    const ctx = await readEventTx(tx, reg.eventId);
    if (
      ctx.event.status !== "scheduled" ||
      reg.attendance !== "held" ||
      !reg.holdExpiresAt ||
      new Date(reg.holdExpiresAt).getTime() <= now.getTime()
    )
      throw conflict("This offer has expired.");
    tx.update(ref, {
      attendance: "active",
      payment: reg.amountCents ? "unpaid" : "fee_waived",
      holdExpiresAt: null,
    });
    ctx.locks[reg.poolId]!.places[reg.id] = {
      state: "active",
      rosterName: rosterName(reg),
      since: now.toISOString(),
    };
    if (reg.offerId)
      tx.update(db.doc(`waitlist/${reg.offerId}`), { status: "accepted" });
    writeEventTx(tx, ctx, now, [reg.poolId]);
  });
}
