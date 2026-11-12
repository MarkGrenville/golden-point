import { makeEvent } from "@/lib/booking/fixtures";
import type { EventDate, Workspace } from "@/lib/booking/types";
import { adminApp, adminDb } from "@/server/admin";
import { refreshProjection } from "@/server/context";

import { assertTestEmulator, TEST_PROJECT_ID } from "./emulator-project";

export async function clearFirestore() {
  assertTestEmulator(adminApp().options.projectId);
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("Run via npm run test:emulator");
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${TEST_PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Could not clear test Firestore: ${response.status}`);
}

export async function seedEvent(
  overrides: Partial<EventDate> = {},
  courts = 1,
): Promise<EventDate> {
  const db = adminDb();
  const ws: Workspace = {
    id: "w1",
    name: "Thursday",
    ownerUid: "owner",
    members: { owner: "owner", scorer1: "scorer" },
    merchant: { status: "verified", sandbox: true },
    createdAt: new Date().toISOString(),
  };
  await db.doc("workspaces/w1").set(ws);
  const soon = new Date(Date.now() + 3 * 86400_000);
  const event = makeEvent({
    id: overrides.id ?? "e1",
    registrationOpensAt: new Date(Date.now() - 3600_000).toISOString(),
    pools: [
      {
        id: "pool1",
        label: "18:00",
        startsAt: soon.toISOString(),
        endsAt: new Date(soon.getTime() + 5400_000).toISOString(),
        playerLimit: courts * 4,
      },
    ],
    ...overrides,
  });
  await db.doc(`events/${event.id}`).set(event);
  await refreshProjection(event.id);
  return event;
}

export const guest = (i: number) => ({
  poolId: "pool1",
  displayName: `Guest ${i}`,
  email: `guest${i}@example.com`,
  showOnRoster: true,
});
