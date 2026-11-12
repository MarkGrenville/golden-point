import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { projectEvent, type PoolLock } from "@/lib/booking/projection";
import type { EventDate, MerchantStatus, Workspace } from "@/lib/booking/types";
import { adminDb } from "./admin";
import { isDevSandboxDate } from "./dev-sandbox";
import { notFound } from "./errors";

export const lockId = (eventId: string, poolId: string) =>
  `${eventId}__${poolId}`;
export const lockRef = (eventId: string, poolId: string) =>
  adminDb().doc(
    `eventPools/${lockId(eventId, poolId)}`,
  ) as DocumentReference<PoolLock>;
export const eventRef = (eventId: string) =>
  adminDb().doc(`events/${eventId}`) as DocumentReference<EventDate>;

export interface EventTx {
  event: EventDate;
  merchant: MerchantStatus;
  locks: Record<string, PoolLock>;
  organiserName: string;
  paymentLink: string | null;
}

/** Read everything a seat mutation needs. Firestore transactions require all reads before writes. */
export async function readEventTx(
  tx: Transaction,
  eventId: string,
): Promise<EventTx> {
  const eventSnap = await tx.get(eventRef(eventId));
  if (!eventSnap.exists) throw notFound("Date not found");
  const event = eventSnap.data()!;
  const [wsSnap, ...lockSnaps] = await Promise.all([
    tx.get(adminDb().doc(`workspaces/${event.workspaceId}`)),
    ...event.pools.map((p) => tx.get(lockRef(eventId, p.id))),
  ]);
  const locks: Record<string, PoolLock> = {};
  event.pools.forEach((p, i) => {
    locks[p.id] = (lockSnaps[i]!.data() as PoolLock | undefined) ?? {
      eventId,
      poolId: p.id,
      places: {},
    };
  });
  return {
    event,
    merchant:
      isDevSandboxDate(event) ? "verified" : (wsSnap!.data() as Workspace | undefined)?.merchant.status ?? "none",
    locks,
    organiserName: wsSnap!.data()?.name ?? "the organiser",
    paymentLink: wsSnap!.data()?.paymentLink ?? null,
  };
}

/** Write changed locks and the public projection in the same transaction. */
export function writeEventTx(
  tx: Transaction,
  ctx: EventTx,
  now: Date,
  changedPools: string[] = Object.keys(ctx.locks),
) {
  for (const poolId of changedPools)
    tx.set(lockRef(ctx.event.id, poolId), ctx.locks[poolId]!);
  tx.set(adminDb().doc(`publicEvents/${ctx.event.id}`), {
    ...projectEvent(ctx.event, ctx.merchant, ctx.locks, now),
    organiserName: ctx.organiserName,
    paymentLink: ctx.paymentLink,
  });
}

/** Rebuild the projection outside a seat mutation (e.g. after editing a date). */
export async function refreshProjection(eventId: string, now = new Date()) {
  await adminDb().runTransaction(async (tx) => {
    const ctx = await readEventTx(tx, eventId);
    tx.set(adminDb().doc(`publicEvents/${eventId}`), {
      ...projectEvent(ctx.event, ctx.merchant, ctx.locks, now),
      organiserName: ctx.organiserName,
      paymentLink: ctx.paymentLink,
    });
  });
}
