import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { EventDate, Group, Workspace } from "@/lib/booking/types";
import { sastInstant } from "@/lib/shared/time";
import { adminDb } from "./admin";
import { requirePermission, type Caller } from "./auth";
import { refreshProjection } from "./context";
import { devSandboxEnabled } from "./dev-sandbox";
import { forbidden } from "./errors";

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const weeklyDateInput = z.object({
  title: z.string().trim().min(1).max(80),
  organiserName: z.string().trim().min(1).max(80),
  venue: z.string().trim().min(1).max(80),
  date: z.iso.date(),
  startTime: time,
  endTime: time,
  playerLimit: z.number().int().min(4).max(32),
  priceCents: z.number().int().min(0).max(1000000),
  format: z.enum(["doubles", "americano", "mexicano"]).default("doubles"),
  dropOutBefore: z.iso.datetime({ offset: true }).nullable().default(null),
  devSandbox: z.boolean().default(false),
  workspaceId: z.string().regex(/^[\w-]{1,100}$/).optional(),
}).superRefine((v, ctx) => {
  const start = sastInstant(v.date, v.startTime).getTime();
  if (start <= Date.now()) ctx.addIssue({ code: "custom", message: "Choose a future date and start time.", path: ["date"] });
  if (v.endTime <= v.startTime) ctx.addIssue({ code: "custom", message: "End time must be after start time on the same day.", path: ["endTime"] });
  if (v.dropOutBefore && new Date(v.dropOutBefore).getTime() > start)
    ctx.addIssue({ code: "custom", message: "The drop-out deadline must be before play starts.", path: ["dropOutBefore"] });
});

const hash = (s: string) => createHash("sha256").update(s).digest();

/** One transaction creates a published date and its private management capability. */
export async function createWeeklyDate(input: z.input<typeof weeklyDateInput>, caller: Caller | null) {
  const v = weeklyDateInput.parse(input);
  if (v.devSandbox && !devSandboxEnabled()) throw forbidden("DEV ONLY — sandbox dates require the local development emulator.");
  const db = adminDb();
  const id = db.collection("events").doc().id;
  const token = randomBytes(32).toString("hex");
  const guestUid = `guest-${id}`;
  const uid = caller?.uid ?? guestUid;
  const existing = v.workspaceId ? await requirePermission(v.workspaceId, caller?.uid ?? "", "manage_events") : null;
  const workspaceId = existing?.id ?? db.collection("workspaces").doc().id;
  const createdAt = new Date().toISOString();
  const slug = `weekly-${id.toLowerCase()}`;
  const groupId = db.collection("groups").doc().id;
  const group: Group = { id: groupId, workspaceId, slug, name: v.title, description: "", kind: "single", createdAt };
  const ws: Workspace = { id: workspaceId, name: v.organiserName, ownerUid: uid, members: { [uid]: "owner" }, merchant: { status: "none", sandbox: true }, createdAt };
  const event: EventDate = {
    devSandbox: v.devSandbox,
    id, workspaceId, groupId, groupSlug: slug, title: v.title, date: v.date,
    venue: v.venue, format: v.format, allocationMode: v.format === "doubles" ? "organiser_assigns" : "tournament_pool",
    priceCents: v.priceCents, eventConfirmed: true, status: "scheduled", createdAt,
    registrationOpensAt: createdAt, dropOutBefore: v.dropOutBefore,
    pools: [{ id: "pool1", label: "Players", startsAt: sastInstant(v.date, v.startTime).toISOString(), endsAt: sastInstant(v.date, v.endTime).toISOString(), playerLimit: v.playerLimit }],
  };
  await db.runTransaction(async (tx) => {
    if (!existing) tx.create(db.doc(`workspaces/${workspaceId}`), ws);
    tx.create(db.doc(`groups/${groupId}`), group);
    tx.create(db.doc(`publicGroups/${slug}`), { slug, name: v.title, description: "", workspaceId, groupId });
    tx.create(db.doc(`slugs/${slug}`), { groupId, workspaceId });
    tx.create(db.doc(`events/${id}`), event);
    // Only guest-created workspaces accept capability access. Connected PayFast stays behind sign-in.
    if (!caller) tx.create(db.doc(`guestDates/${id}`), { tokenHash: hash(token).toString("hex"), uid: guestUid, workspaceId });
  });
  await refreshProjection(id);
  return { id, publicUrl: `/e/${id}`, manageUrl: `/admin/e/${id}${caller ? "" : `#${token}`}` };
}

/** A private link is scoped to one date, never to the rest of an organiser's account. */
export async function guestDateCaller(eventId: string, token: string): Promise<Caller> {
  if (!/^[\w-]{1,100}$/.test(eventId) || !/^[a-f0-9]{64}$/.test(token)) throw forbidden("Use your private organiser link.");
  const owner = (await adminDb().doc(`guestDates/${eventId}`).get()).data();
  const stored = Buffer.from(owner?.tokenHash ?? "", "hex");
  if (stored.length !== 32 || !timingSafeEqual(stored, hash(token))) throw forbidden("Use your private organiser link.");
  return { uid: owner!.uid, emailVerified: false };
}

/** The private organiser link proves ownership; claiming never exposes it publicly. */
export async function claimWeeklyDate(eventId: string, token: string, caller: Caller) {
  // Validate the capability before reading the workspace, then recheck it in the transaction.
  await guestDateCaller(eventId, token);
  const db = adminDb();
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`guestDates/${eventId}`);
    const guest = (await tx.get(ref)).data();
    if (!guest || guest.tokenHash !== hash(token).toString("hex")) throw forbidden();
    if (guest.claimedBy && guest.claimedBy !== caller.uid) throw forbidden("This date is already saved to another organiser’s account.");
    if (guest.claimedBy === caller.uid) return { ok: true, workspaceId: guest.workspaceId };
    const workspaceRef = db.doc(`workspaces/${guest.workspaceId}`);
    const workspace = (await tx.get(workspaceRef)).data() as Workspace | undefined;
    if (!workspace) throw forbidden();
    tx.update(workspaceRef, {
      ownerUid: caller.uid,
      members: { [caller.uid]: "owner" },
    });
    tx.update(ref, { uid: caller.uid, claimedBy: caller.uid });
    tx.set(db.doc(`workspaces/${guest.workspaceId}/members/${caller.uid}`), { role: "owner" });
    return { ok: true, workspaceId: guest.workspaceId };
  });
}
