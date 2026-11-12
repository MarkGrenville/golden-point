import type { Cents } from "@/lib/shared/money";
import type { ItnPayload, ItnStatus } from "./payfast";

export type PaymentMethod = "payfast" | "external_transfer" | "cash" | "waiver";
export type PaymentState =
  "initiated" | "pending" | "complete" | "failed" | "cancelled";

export interface PaymentRecord {
  /** Deterministic: the checkout reference sent as m_payment_id. */
  id: string;
  workspaceId: string;
  eventId: string;
  registrationId: string;
  method: PaymentMethod;
  state: PaymentState;
  amountCents: Cents;
  feeCents: Cents;
  pfPaymentId?: string;
  /** Idempotency keys of every notification already applied. */
  appliedNotifications: string[];
  /** Out-of-order or contradictory notifications needing human review. */
  exceptions: string[];
  recordedBy?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

const RANK: Record<PaymentState, number> = {
  initiated: 0,
  pending: 1,
  cancelled: 2,
  failed: 2,
  complete: 3,
};
const ITN_STATE: Record<ItnStatus, PaymentState> = {
  COMPLETE: "complete",
  PENDING: "pending",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

export type ItnEffect = "duplicate" | "applied" | "ignored_stale" | "exception";

/**
 * Apply a verified notification. Duplicates are no-ops; a later state never regresses
 * (PENDING after COMPLETE is stale); contradictions after COMPLETE become exceptions.
 */
export function applyItn(
  payment: PaymentRecord,
  itn: ItnPayload,
  now: string,
): { payment: PaymentRecord; effect: ItnEffect } {
  const key = `${itn.pfPaymentId}:${itn.status}`;
  if (payment.appliedNotifications.includes(key))
    return { payment, effect: "duplicate" };
  const next = ITN_STATE[itn.status];
  const base = {
    ...payment,
    appliedNotifications: [...payment.appliedNotifications, key],
    updatedAt: now,
  };

  if (
    payment.pfPaymentId &&
    payment.pfPaymentId !== itn.pfPaymentId &&
    payment.state === "complete"
  ) {
    return {
      payment: {
        ...base,
        exceptions: [
          ...payment.exceptions,
          `Second completed transaction ${itn.pfPaymentId} for the same checkout`,
        ],
      },
      effect: "exception",
    };
  }
  if (payment.state === "complete" && next !== "complete") {
    return {
      payment: {
        ...base,
        exceptions: [
          ...payment.exceptions,
          `${itn.status} received after COMPLETE`,
        ],
      },
      effect: "exception",
    };
  }
  if (RANK[next] < RANK[payment.state])
    return { payment: base, effect: "ignored_stale" };
  return {
    payment: {
      ...base,
      state: next,
      pfPaymentId: itn.pfPaymentId,
      feeCents: itn.feeCents || payment.feeCents,
    },
    effect: "applied",
  };
}

/** What to do with a registration when its payment completes. */
export type AllocationDecision =
  | "confirm"
  | "late_allocate"
  | "late_no_capacity"
  | "already_confirmed"
  | "settle_withdrawn";

export function allocationOnComplete(
  attendance: string,
  holdExpiresAt: string | undefined,
  capacityRemainingExcludingThis: number,
  now: Date,
): AllocationDecision {
  if (attendance === "active" || attendance === "attended")
    return "already_confirmed";
  if (attendance === "withdrawn") return "settle_withdrawn";
  const holdValid =
    attendance === "held" &&
    !!holdExpiresAt &&
    new Date(holdExpiresAt).getTime() > now.getTime();
  if (holdValid) return "confirm";
  // Late payment: allocate only if capacity remains, never oversell or move the player.
  return capacityRemainingExcludingThis > 0
    ? "late_allocate"
    : "late_no_capacity";
}
