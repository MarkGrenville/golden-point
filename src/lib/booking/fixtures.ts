import type { EventDate, Registration } from "./types";

/** Shared test/demo builders. */
export function makeEvent(overrides: Partial<EventDate> = {}): EventDate {
  return {
    id: "e1",
    workspaceId: "w1",
    groupId: "g1",
    groupSlug: "thursday-golden-point",
    title: "Golden Point Thursdays",
    date: "2026-11-05",
    venue: "Club",
    format: "doubles",
    allocationMode: "organiser_assigns",
    priceCents: 15000,
    eventConfirmed: true,
    status: "scheduled",
    pools: [
      {
        id: "pool1",
        label: "18:00",
        startsAt: "2026-11-05T16:00:00.000Z",
        endsAt: "2026-11-05T17:30:00.000Z",
        playerLimit: 4,
      },
    ],
    registrationOpensAt: "2026-11-02T17:00:00.000Z",
    createdAt: "2026-10-27T00:00:00.000Z",
    ...overrides,
  };
}

export function makeReg(
  id: string,
  i: number,
  overrides: Partial<Registration> = {},
): Registration {
  const at = new Date(Date.UTC(2026, 10, 2, 17, i)).toISOString();
  return {
    id,
    eventId: "e1",
    workspaceId: "w1",
    poolId: "pool1",
    displayName: `Player ${i}`,
    showOnRoster: true,
    contactEmail: `p${i}@example.com`,
    attendance: "active",
    payment: "paid_online",
    settlement: "none",
    amountCents: 15000,
    paidAt: at,
    createdAt: at,
    ...overrides,
  };
}
