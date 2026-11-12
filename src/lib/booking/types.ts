import type { Cents } from "@/lib/shared/money";

/** Instants are ISO-8601 strings in UTC; local presentation uses Africa/Johannesburg. */
export type Instant = string;

export type Role = "owner" | "organiser" | "scorer";
export type Permission =
  "manage_workspace" | "manage_events" | "manage_payments" | "score";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ["manage_workspace", "manage_events", "manage_payments", "score"],
  organiser: ["manage_events", "manage_payments", "score"],
  scorer: ["score"],
};

export type MerchantStatus = "none" | "verified";

export interface Workspace {
  id: string;
  name: string;
  ownerUid: string;
  /** uid → role. Mirrored as members/{uid} docs for rules. */
  members: Record<string, Role>;
  paymentLink?: string | null;
  merchant: { status: MerchantStatus; sandbox: boolean; suffix?: string };
  createdAt: Instant;
}

export type EventFormat = "doubles" | "americano" | "mexicano";
export type AllocationMode = "organiser_assigns" | "tournament_pool";

export interface RecurringTemplate {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  venue: string;
  pools: { label: string; startTime: string; endTime: string }[];
  format: EventFormat;
  allocationMode: AllocationMode;
  priceCents: Cents;
  weeksAhead: number;
  /** Offsets relative to the event date, in SAST. */
  opensDaysBefore: number;
  opensAtTime: string;
  playerLimit: number;
}

export interface Group {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  description: string;
  kind: "single" | "recurring" | "tournament_series";
  template?: RecurringTemplate;
  createdAt: Instant;
}

export interface TimePool {
  id: string;
  label: string;
  startsAt: Instant;
  endsAt: Instant;
  /** Maximum players for this time slot (4–32). */
  playerLimit?: number;
}

export type EventStatus = "draft" | "scheduled" | "cancelled" | "completed";

export interface EventDate {
  /** Public test merchant, honoured only on the local development emulator. */
  devSandbox?: boolean;
  id: string;
  workspaceId: string;
  groupId: string;
  groupSlug: string;
  title: string;
  date: string;
  venue: string;
  format: EventFormat;
  allocationMode: AllocationMode;
  priceCents: Cents;
  eventConfirmed: boolean;
  status: EventStatus;
  pools: TimePool[];
  registrationOpensAt?: Instant;
  dropOutBefore?: Instant | null;
  createdAt: Instant;
}

export type AttendanceStatus =
  "held" | "active" | "withdrawn" | "released" | "attended" | "no_show";
export type PaymentStatus =
  | "unpaid"
  | "pending"
  | "paid_online"
  | "paid_externally"
  | "cash_received"
  | "fee_waived"
  | "late_unallocated";
export type SettlementStatus = "none" | "due" | "settled";

/** Private registration record. The public roster is a separate projection. */
export interface Registration {
  id: string;
  eventId: string;
  workspaceId: string;
  poolId: string;
  displayName: string;
  alias?: string;
  showOnRoster: boolean;
  contactEmail: string;
  uid?: string;
  attendance: AttendanceStatus;
  payment: PaymentStatus;
  settlement: SettlementStatus;
  amountCents: Cents;
  holdExpiresAt?: Instant;
  paidAt?: Instant;
  withdrawnAt?: Instant;
  settlementCents?: Cents;
  createdAt: Instant;
  /** Set when a waiting-list offer created this registration. */
  offerId?: string;
}

export type WaitlistStatus =
  "waiting" | "offered" | "accepted" | "expired" | "removed";

export interface WaitlistEntry {
  id: string;
  eventId: string;
  displayName: string;
  contactEmail: string;
  uid?: string;
  acceptablePoolIds: string[];
  status: WaitlistStatus;
  createdAt: Instant;
  offer?: { poolId: string; expiresAt: Instant; registrationId?: string };
}

export interface AuditEvent {
  at: Instant;
  actorUid: string | null;
  action: string;
  target: string;
  reason?: string;
  detail?: Record<string, unknown>;
}
