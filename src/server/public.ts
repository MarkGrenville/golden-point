import { isDevSandboxDate, isDevSandboxConnection } from "./dev-sandbox";
import type { PublicEvent } from "@/lib/booking/projection";
import { expireEventHolds } from "./booking";
import { refreshProjection } from "./context";
import { adminDb } from "./admin";

/** Public pages receive explicit projections; private contacts never cross this boundary. */
export async function publicGroup(slug: string) {
  const db = adminDb();
  const group = (await db.doc(`publicGroups/${slug}`).get()).data() as
    { slug: string; name: string; description: string } | undefined;
  if (!group) return null;
  const events = await db
    .collection("publicEvents")
    .where("groupSlug", "==", slug)
    .orderBy("date")
    .get();
  const today = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  return {
    group,
    events: (await Promise.all(events.docs.map((d) => publicEvent(d.id))))
      .filter((e): e is PublicEvent => !!e)
      .filter((e) => e.date >= today && e.status !== "draft"),
  };
}

export async function publicEvent(id: string) {
  const db = adminDb();
  const event = await db.doc(`events/${id}`).get();
  if (!event.exists) return null;
  await expireEventHolds(id);
  await refreshProjection(id);
  const e = (await db.doc(`publicEvents/${id}`).get()).data() as PublicEvent;
  const [regs, waiting] = await Promise.all([
    db.collection("registrations").where("eventId", "==", id).get(),
    db.collection("waitlist").where("eventId", "==", id).get(),
  ]);
  const workspace = (await db.doc(`workspaces/${event.data()!.workspaceId}`).get()).data();
  e.devSandbox = isDevSandboxDate(event.data()!) || isDevSandboxConnection(workspace?.merchant);
  e.waiting = waiting.docs
    .map((d) => d.data())
    .filter((w) => ["waiting", "offered"].includes(w.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((w) => ({ name: w.displayName, status: w.status }));
  e.waitingCount = e.waiting.length;
  for (const pool of e.pools)
    pool.roster = regs.docs
      .map((d) => d.data())
      .filter(
        (r) =>
          r.poolId === pool.id && ["active", "attended"].includes(r.attendance),
      )
      .map((r) => ({
        name: r.showOnRoster ? r.alias || r.displayName : "Player",
        paid: [
          "paid_online",
          "paid_externally",
          "cash_received",
          "fee_waived",
        ].includes(r.payment),
      }));
  return e;
}
