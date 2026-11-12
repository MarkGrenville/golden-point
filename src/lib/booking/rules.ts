import { addDays, sastInstant, weekday } from "@/lib/shared/time";
import type {
  EventDate,
  Group,
  MerchantStatus,
  Registration,
  TimePool,
  WaitlistEntry,
} from "./types";

export const HOLD_MINUTES = 10;
export const DEFAULT_TOURNAMENT_LIMIT = 16;

const ms = (iso: string) => new Date(iso).getTime();

// ---------------------------------------------------------------------------
// Capacity

export function poolCapacity(_event: EventDate, pool: TimePool): number {
  return pool.playerLimit ?? DEFAULT_TOURNAMENT_LIMIT;
}

/** A place is occupied by an active registration or an unexpired hold. Expiry is evaluated, never deleted-by-TTL. */
export function occupiesPlace(reg: Registration, now: Date): boolean {
  if (
    reg.attendance === "active" ||
    reg.attendance === "attended" ||
    reg.attendance === "no_show"
  )
    return true;
  if (reg.attendance === "held")
    return !!reg.holdExpiresAt && ms(reg.holdExpiresAt) > now.getTime();
  return false;
}

export function occupancy(
  regs: Registration[],
  poolId: string,
  now: Date,
): number {
  return regs.filter((r) => r.poolId === poolId && occupiesPlace(r, now))
    .length;
}

export function remainingPlaces(
  event: EventDate,
  regs: Registration[],
  poolId: string,
  now: Date,
): number {
  const pool = event.pools.find((p) => p.id === poolId);
  if (!pool) return 0;
  return Math.max(0, poolCapacity(event, pool) - occupancy(regs, poolId, now));
}

// ---------------------------------------------------------------------------
// Registration gate

export interface GateResult {
  open: boolean;
  /** Short status label shown to players; never colour alone. */
  label: string;
  reasons: string[];
}

export function registrationGate(
  event: EventDate,
  poolId: string,
  merchant: MerchantStatus,
  now: Date,
): GateResult {
  const reasons: string[] = [];
  const pool = event.pools.find((p) => p.id === poolId);
  if (event.status === "cancelled")
    return {
      open: false,
      label: "Cancelled",
      reasons: ["This date has been cancelled."],
    };
  if (event.status !== "scheduled")
    reasons.push("This date has not been published.");
  if (!pool)
    return {
      open: false,
      label: "Unavailable",
      reasons: ["Unknown time slot."],
    };
  if (!event.registrationOpensAt)
    reasons.push("No registration opening time is set.");
  else if (ms(event.registrationOpensAt) > now.getTime()) {
    return {
      open: false,
      label: "Opens soon",
      reasons: [`Registration opens at ${event.registrationOpensAt}.`],
    };
  }
  if (poolCapacity(event, pool) <= 0)
    reasons.push("No capacity has been configured.");
  if (ms(pool.startsAt) <= now.getTime())
    reasons.push("This session has already started.");
  return reasons.length
    ? { open: false, label: "Closed", reasons }
    : { open: true, label: "Open", reasons: [] };
}

/** Problems that block publishing an event (separate from whether registration is currently open). */
export function publishProblems(
  event: EventDate,
  merchant: MerchantStatus,
): string[] {
  const problems: string[] = [];
  if (event.pools.length === 0) problems.push("Add at least one time slot.");
  if (!event.registrationOpensAt)
    problems.push("Set a registration opening time.");
  if (
    event.allocationMode === "tournament_pool" &&
    event.pools.some(
      (p) => (p.playerLimit ?? 0) < 4 || (p.playerLimit ?? 0) > 32,
    )
  ) {
    problems.push("Tournament pools need a player limit between 4 and 32.");
  }
  if (
    event.pools.some(
      (p) => !p.playerLimit || p.playerLimit < 4 || p.playerLimit > 32,
    )
  )
    problems.push("Set a player limit between 4 and 32.");
  return problems;
}

// ---------------------------------------------------------------------------
// Recurring drafts

export function upcomingDates(
  group: Group,
  from: string,
  existingDates: string[],
): string[] {
  const t = group.template;
  if (!t) return [];
  let date = from;
  while (weekday(date) !== t.weekday) date = addDays(date, 1);
  const out: string[] = [];
  for (let i = 0; i < t.weeksAhead; i++) {
    const d = addDays(date, i * 7);
    if (!existingDates.includes(d)) out.push(d);
  }
  return out;
}

export function draftFromTemplate(
  group: Group,
  date: string,
  id: string,
  now: Date,
): EventDate {
  const t = group.template;
  if (!t) throw new Error("Group has no recurring template");
  const at = (daysBefore: number, time: string) =>
    sastInstant(addDays(date, -daysBefore), time).toISOString();
  return {
    id,
    workspaceId: group.workspaceId,
    groupId: group.id,
    groupSlug: group.slug,
    title: group.name,
    date,
    venue: t.venue,
    format: t.format,
    allocationMode: t.allocationMode,
    priceCents: t.priceCents,
    eventConfirmed: true,
    status: "draft",
    pools: t.pools.map((p, i) => ({
      id: `pool${i + 1}`,
      label: p.label,
      startsAt: sastInstant(date, p.startTime).toISOString(),
      endsAt: sastInstant(date, p.endTime).toISOString(),
      playerLimit: t.playerLimit,
    })),
    registrationOpensAt: at(t.opensDaysBefore, t.opensAtTime),
    createdAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Waiting list

/** First eligible entry in queue order for a vacancy.  */
export function nextEligibleWaiter(
  entries: WaitlistEntry[],
  poolId: string,
): WaitlistEntry | undefined {
  return [...entries]
    .filter((e) => e.status === "waiting")
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )
    .find((e) => e.acceptablePoolIds.includes(poolId));
}

export const OFFER_MINUTES = 120;

// ---------------------------------------------------------------------------
// Roster projection (public, no contacts or money)

export interface PublicRosterEntry {
  name: string;
  poolId: string;
  status: "confirmed" | "awaiting_event_confirmation" | "attended";
}

export function publicRoster(
  event: EventDate,
  regs: Registration[],
): PublicRosterEntry[] {
  return regs
    .filter((r) => r.attendance === "active" || r.attendance === "attended")
    .sort((a, b) =>
      (a.paidAt ?? a.createdAt).localeCompare(b.paidAt ?? b.createdAt),
    )
    .map((r) => ({
      name: r.showOnRoster ? r.alias || r.displayName : "Player",
      poolId: r.poolId,
      status: r.attendance === "attended" ? "attended" : "confirmed",
    }));
}

export function isFunded(reg: Registration): boolean {
  return [
    "paid_online",
    "paid_externally",
    "cash_received",
    "fee_waived",
  ].includes(reg.payment);
}
