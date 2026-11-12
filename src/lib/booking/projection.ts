import { poolCapacity, registrationGate } from "./rules";
import type { EventDate, MerchantStatus } from "./types";

/**
 * Per-pool place index kept in one document so every hold, payment and withdrawal for
 * the pool serialises on it inside a transaction. This is what prevents overselling.
 */
export interface PlaceEntry {
  state: "held" | "active";
  expiresAt?: string;
  /** Roster label already filtered by the player's privacy choice. */
  rosterName: string;
  since: string;
}

export interface PoolLock {
  eventId: string;
  poolId: string;
  places: Record<string, PlaceEntry>;
}

export function liveEntries(
  lock: PoolLock | undefined,
  now: Date,
): [string, PlaceEntry][] {
  return Object.entries(lock?.places ?? {}).filter(
    ([, p]) =>
      p.state === "active" ||
      (!!p.expiresAt && new Date(p.expiresAt).getTime() > now.getTime()),
  );
}

export function lockRemaining(
  event: EventDate,
  lock: PoolLock | undefined,
  poolId: string,
  now: Date,
  excludeId?: string,
): number {
  const pool = event.pools.find((p) => p.id === poolId);
  if (!pool) return 0;
  const live = liveEntries(lock, now).filter(([id]) => id !== excludeId);
  return Math.max(0, poolCapacity(event, pool) - live.length);
}

export interface PublicEvent {
  devSandbox?: boolean;
  id: string;
  workspaceId: string;
  groupSlug: string;
  title: string;
  date: string;
  venue: string;
  format: EventDate["format"];
  allocationMode: EventDate["allocationMode"];
  priceCents: number;
  eventConfirmed: boolean;
  status: EventDate["status"];
  dropOutBefore: string | null;
  organiserName: string;
  payfastConnected: boolean;
  paymentLink: string | null;
  waiting: { name: string; status: string }[];
  waitingCount: number;
  registrationOpensAt: string | null;
  pools: {
    id: string;
    label: string;
    startsAt: string;
    endsAt: string;
    capacity: number;
    remaining: number;
    gateLabel: string;
    gateOpen: boolean;
    gateReasons: string[];
    roster: { name: string; paid?: boolean }[];
  }[];
  updatedAt: string;
}

/** Public projection: names permitted by each player, places and policy — never contacts or money records. */
export function projectEvent(
  event: EventDate,
  merchant: MerchantStatus,
  locks: Record<string, PoolLock | undefined>,
  now: Date,
): PublicEvent {
  return {
    id: event.id,
    workspaceId: event.workspaceId,
    groupSlug: event.groupSlug,
    title: event.title,
    date: event.date,
    venue: event.venue,
    format: event.format,
    allocationMode: event.allocationMode,
    priceCents: event.priceCents,
    eventConfirmed: event.eventConfirmed,
    status: event.status,
    dropOutBefore: event.dropOutBefore ?? null,
    organiserName: "the organiser",
    payfastConnected: merchant === "verified",
    paymentLink: null,
    waiting: [],
    waitingCount: 0,
    registrationOpensAt: event.registrationOpensAt ?? null,
    pools: event.pools.map((pool) => {
      const lock = locks[pool.id];
      const gate = registrationGate(event, pool.id, merchant, now);
      const active = Object.values(lock?.places ?? {})
        .filter((p) => p.state === "active")
        .sort((a, b) => a.since.localeCompare(b.since));
      return {
        id: pool.id,
        label: pool.label,
        startsAt: pool.startsAt,
        endsAt: pool.endsAt,
        capacity: poolCapacity(event, pool),
        remaining: lockRemaining(event, lock, pool.id, now),
        gateLabel: gate.label,
        gateOpen: gate.open,
        gateReasons: gate.reasons,
        roster: active.map((p) => ({ name: p.rosterName })),
      };
    }),
    updatedAt: now.toISOString(),
  };
}
