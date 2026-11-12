import { encryptKeys } from "./payment-keys";
import { z } from "zod";
import {
  draftFromTemplate,
  publishProblems,
  upcomingDates,
} from "@/lib/booking/rules";
import type {
  EventDate,
  Group,
  Registration,
  Role,
  Workspace,
} from "@/lib/booking/types";
import { sastDate } from "@/lib/shared/time";
import { adminAuth, adminDb } from "./admin";
import { audit } from "./audit";
import { requirePermission, type Caller } from "./auth";
import { expireEventHolds } from "./booking";
import { settlementFor } from "@/lib/booking/settlement";
import { readEventTx, refreshProjection, writeEventTx } from "./context";
import { badRequest, conflict, forbidden, notFound } from "./errors";

const iso = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s).toISOString());
const slugRe = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

// ---------------------------------------------------------------------------
// Workspaces and roles

export async function createWorkspace(caller: Caller, name: string) {
  const db = adminDb();
  const ref = db.collection("workspaces").doc();
  const ws: Workspace = {
    id: ref.id,
    name: name.trim().slice(0, 80),
    ownerUid: caller.uid,
    members: { [caller.uid]: "owner" },
    merchant: { status: "none", sandbox: true },
    createdAt: new Date().toISOString(),
  };
  await db.runTransaction(async (tx) => {
    tx.set(ref, ws);
    tx.set(db.doc(`workspaces/${ref.id}/members/${caller.uid}`), {
      role: "owner",
    });
    audit(tx, ref.id, {
      actorUid: caller.uid,
      action: "workspace.create",
      target: ref.id,
    });
  });
  return ws;
}

export async function myWorkspaces(caller: Caller) {
  const snap = await adminDb()
    .collection("workspaces")
    .where(`members.${caller.uid}`, "in", ["owner", "organiser", "scorer"])
    .get();
  return snap.docs.map((d) => {
    const ws = d.data() as Workspace;
    return {
      id: ws.id,
      name: ws.name,
      role: ws.members[caller.uid],
      merchant: merchantSummary(ws),
    };
  });
}

export async function setMember(
  workspaceId: string,
  caller: Caller,
  email: string,
  role: Role | null,
) {
  const ws = await requirePermission(
    workspaceId,
    caller.uid,
    "manage_workspace",
  );
  const user = await adminAuth()
    .getUserByEmail(email.toLowerCase())
    .catch(() => null);
  if (!user)
    throw notFound(
      "That person needs to sign in once before they can be added.",
    );
  if (user.uid === ws.ownerUid)
    throw forbidden("The owner's role cannot be changed.");
  const db = adminDb();
  await db.runTransaction(async (tx) => {
    const members = { ...ws.members };
    if (role) members[user.uid] = role;
    else delete members[user.uid];
    tx.update(db.doc(`workspaces/${workspaceId}`), { members });
    const m = db.doc(`workspaces/${workspaceId}/members/${user.uid}`);
    if (role) tx.set(m, { role });
    else tx.delete(m);
    audit(tx, workspaceId, {
      actorUid: caller.uid,
      action: "member.set",
      target: user.uid,
      detail: { role },
    });
  });
}

// ---------------------------------------------------------------------------
// Groups and dates

const templateInput = z.object({
  weekday: z.number().int().min(0).max(6),
  venue: z.string().min(1).max(80),
  pools: z
    .array(
      z.object({
        label: z.string().min(1).max(30),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .min(1)
    .max(4),
  format: z.enum(["doubles", "americano", "mexicano"]),
  allocationMode: z.enum(["organiser_assigns", "tournament_pool"]),
  priceCents: z.number().int().nonnegative(),
  weeksAhead: z.number().int().min(1).max(8).default(3),
  opensDaysBefore: z.number().int().min(0).max(14),
  opensAtTime: z.string().regex(/^\d{2}:\d{2}$/),
  playerLimit: z.number().int().min(4).max(32).default(16),
});

export const groupInput = z.object({
  slug: z
    .string()
    .toLowerCase()
    .regex(slugRe, "Use 3–48 lowercase letters, numbers and dashes."),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(""),
  kind: z.enum(["single", "recurring", "tournament_series"]),
  template: templateInput.optional(),
});

export async function createGroup(
  workspaceId: string,
  caller: Caller,
  input: z.infer<typeof groupInput>,
) {
  await requirePermission(workspaceId, caller.uid, "manage_events");
  if (input.kind === "recurring" && !input.template)
    throw badRequest("A recurring group needs a weekly template.");
  const db = adminDb();
  const ref = db.collection("groups").doc();
  const group: Group = {
    id: ref.id,
    workspaceId,
    ...input,
    createdAt: new Date().toISOString(),
  };
  await db.runTransaction(async (tx) => {
    const slugRef = db.doc(`slugs/${input.slug}`);
    if ((await tx.get(slugRef)).exists)
      throw conflict("That link is already taken.", "slug_taken");
    tx.create(slugRef, { groupId: ref.id, workspaceId });
    tx.set(ref, group);
    tx.set(db.doc(`publicGroups/${input.slug}`), {
      slug: input.slug,
      name: group.name,
      description: group.description,
      workspaceId,
      groupId: ref.id,
    });
    audit(tx, workspaceId, {
      actorUid: caller.uid,
      action: "group.create",
      target: ref.id,
      detail: { slug: input.slug },
    });
  });
  return group;
}

export async function loadGroup(groupId: string) {
  const g = (await adminDb().doc(`groups/${groupId}`).get()).data() as
    Group | undefined;
  if (!g) throw notFound("Group not found");
  return g;
}

/** Prepare the next weeks as drafts for the organiser to publish. */
export async function generateDrafts(
  groupId: string,
  caller: Caller,
  now = new Date(),
) {
  const group = await loadGroup(groupId);
  await requirePermission(group.workspaceId, caller.uid, "manage_events");
  const db = adminDb();
  const existing = await db
    .collection("events")
    .where("groupId", "==", groupId)
    .get();
  const dates = upcomingDates(
    group,
    sastDate(now),
    existing.docs.map((d) => (d.data() as EventDate).date),
  );
  const created: EventDate[] = [];
  for (const date of dates) {
    const ref = db.collection("events").doc(`${group.slug}-${date}`);
    const draft = draftFromTemplate(group, date, ref.id, now);
    await ref.create(draft).catch(() => undefined);
    await refreshProjection(ref.id, now);
    created.push(draft);
  }
  await audit(null, group.workspaceId, {
    actorUid: caller.uid,
    action: "event.drafts",
    target: groupId,
    detail: { dates },
  });
  return created;
}

export const eventInput = z.object({
  title: z.string().trim().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venue: z.string().min(1).max(80),
  format: z.enum(["doubles", "americano", "mexicano"]),
  allocationMode: z.enum(["organiser_assigns", "tournament_pool"]),
  priceCents: z.number().int().nonnegative(),
  pools: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        startsAt: iso,
        endsAt: iso,
        playerLimit: z.number().int().min(4).max(32).optional(),
      }),
    )
    .min(1),
  registrationOpensAt: iso,
  dropOutBefore: iso.nullable().optional(),
});

export async function createEvent(
  groupId: string,
  caller: Caller,
  input: z.infer<typeof eventInput>,
) {
  const group = await loadGroup(groupId);
  await requirePermission(group.workspaceId, caller.uid, "manage_events");
  const db = adminDb();
  const ref = db
    .collection("events")
    .doc(
      `${group.slug}-${input.date}-${Math.random().toString(36).slice(2, 6)}`,
    );
  const rest = input;
  const event: EventDate = {
    ...rest,
    id: ref.id,
    workspaceId: group.workspaceId,
    groupId,
    groupSlug: group.slug,
    eventConfirmed: true,
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  await ref.create(event);
  await refreshProjection(ref.id);
  await audit(null, group.workspaceId, {
    actorUid: caller.uid,
    action: "event.create",
    target: ref.id,
  });
  return event;
}

async function loadEventFor(
  eventId: string,
  caller: Caller,
  permission: "manage_events" | "manage_payments" = "manage_events",
) {
  const event = (await adminDb().doc(`events/${eventId}`).get()).data() as
    EventDate | undefined;
  if (!event) throw notFound("Date not found");
  await requirePermission(event.workspaceId, caller.uid, permission);
  return event;
}

export const eventPatch = eventInput.partial().extend({
  /** Required to change allocation mode once anyone has registered. */
  transitionReason: z.string().min(3).optional(),
});

export async function updateEvent(
  eventId: string,
  caller: Caller,
  patch: z.infer<typeof eventPatch>,
) {
  const before = await loadEventFor(eventId, caller);
  const db = adminDb();
  await db.runTransaction(async (tx) => {
    const ctx = await readEventTx(tx, eventId);
    const players = Object.values(ctx.locks).reduce(
      (n, l) => n + Object.keys(l.places).length,
      0,
    );
    if (
      patch.allocationMode &&
      patch.allocationMode !== ctx.event.allocationMode &&
      players > 0 &&
      !patch.transitionReason
    ) {
      throw conflict(
        "Players have already registered under the current allocation mode. Review the change and give a reason.",
        "transition_review",
      );
    }
    if (
      patch.priceCents !== undefined &&
      patch.priceCents !== ctx.event.priceCents &&
      players > 0
    ) {
      throw conflict("The price cannot change after someone has registered.");
    }
    const { transitionReason, ...rest } = patch;
    const next: EventDate = { ...ctx.event, ...rest };
    tx.set(db.doc(`events/${eventId}`), next);
    ctx.event = next;
    writeEventTx(tx, ctx, new Date(), []);
    audit(tx, before.workspaceId, {
      actorUid: caller.uid,
      action: "event.update",
      target: eventId,
      reason: transitionReason,
      detail: { fields: Object.keys(patch) },
    });
  });
}

export async function publishEvent(eventId: string, caller: Caller) {
  const event = await loadEventFor(eventId, caller);
  const ws = (
    await adminDb().doc(`workspaces/${event.workspaceId}`).get()
  ).data() as Workspace;
  const problems = publishProblems(event, ws.merchant.status);
  if (problems.length) throw conflict(problems.join(" "), "not_ready");
  const db = adminDb();
  await db.runTransaction(async (tx) => {
    const ctx = await readEventTx(tx, eventId);
    ctx.event = { ...ctx.event, status: "scheduled" };
    tx.update(db.doc(`events/${eventId}`), { status: "scheduled" });
    writeEventTx(tx, ctx, new Date(), []);
    audit(tx, event.workspaceId, {
      actorUid: caller.uid,
      action: "event.publish",
      target: eventId,
    });
  });
}

/** Cancel a date and record money to settle in person. */
export async function cancelEvent(
  eventId: string,
  reason: string,
  caller: Caller,
  now = new Date(),
) {
  const event = await loadEventFor(eventId, caller, "manage_payments");
  const db = adminDb();
  await db.runTransaction(async (tx) => {
    const ctx = await readEventTx(tx, eventId);
    const fresh = (
      await tx.get(
        db.collection("registrations").where("eventId", "==", eventId),
      )
    ).docs;
    ctx.event = { ...ctx.event, status: "cancelled" };
    tx.update(db.doc(`events/${eventId}`), { status: "cancelled" });
    fresh.forEach((snap) => {
      const reg = snap.data() as Registration;
      if (reg.attendance !== "active" && reg.attendance !== "held") return;
      tx.update(snap.ref, { attendance: "released", ...settlementFor(reg) });
    });
    for (const l of Object.values(ctx.locks)) l.places = {};
    writeEventTx(tx, ctx, now);
    audit(tx, event.workspaceId, {
      actorUid: caller.uid,
      action: "event.cancel",
      target: eventId,
      reason,
    });
  });
}

// ---------------------------------------------------------------------------
// Dashboards

export async function workspaceOverview(workspaceId: string, caller: Caller) {
  const ws = await requirePermission(workspaceId, caller.uid, "score");
  const db = adminDb();
  const [groups, events, tournaments] = await Promise.all([
    db.collection("groups").where("workspaceId", "==", workspaceId).get(),
    db.collection("publicEvents").where("workspaceId", "==", workspaceId).get(),
    db.collection("tournaments").where("workspaceId", "==", workspaceId).get(),
  ]);
  return {
    workspace: {
      id: ws.id,
      name: ws.name,
      role: ws.members[caller.uid],
      merchant: merchantSummary(ws),
      members: ws.members,
    },
    groups: groups.docs.map((d) => d.data() as Group),
    events: events.docs
      .map((d) => d.data())
      .sort((a, b) => String(a.date).localeCompare(String(b.date))),
    tournaments: tournaments.docs.map((d) => ({
      id: d.id,
      name: d.data().tournament?.name,
      status: d.data().tournament?.status,
    })),
  };
}

export async function eventDashboard(eventId: string, caller: Caller) {
  const event = await loadEventFor(eventId, caller);
  await expireEventHolds(eventId);
  const db = adminDb();
  const [regs, waiting] = await Promise.all([
    db.collection("registrations").where("eventId", "==", eventId).get(),
    db.collection("waitlist").where("eventId", "==", eventId).get(),
  ]);
  const ws = await requirePermission(
    event.workspaceId,
    caller.uid,
    "manage_events",
  );
  return {
    event,
    organiserName: ws.name,
    registrations: regs.docs.map((d) => {
      const { accessTokenHash, ...r } = d.data();
      return r;
    }),
    waitlist: waiting.docs
      .map((d) => { const { accessTokenHash, bookingToken, ...entry } = d.data(); return entry; })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    publishProblems: publishProblems(event, ws.merchant.status),
  };
}

// Only this allow-listed summary crosses the server boundary.
function merchantSummary(ws: Workspace) {
  return {
    status: ws.merchant.status,
    sandbox: ws.merchant.sandbox,
    ...(ws.merchant.suffix ? { suffix: ws.merchant.suffix } : {}),
  };
}

export async function paymentSettings(workspaceId: string, caller: Caller) {
  const ws = await requirePermission(workspaceId, caller.uid, "manage_workspace");
  return { name: ws.name, merchant: merchantSummary(ws), paymentLink: ws.paymentLink ?? "" };
}

const paymentLink = z.string().trim().max(2048).url()
  .refine((s) => {
    try {
      const url = new URL(s);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use an HTTPS payment link without a username or password")
  .or(z.literal(""));

export const paymentLinkInput = z.object({ paymentLink });

export async function setPaymentLink(workspaceId: string, caller: Caller, input: z.infer<typeof paymentLinkInput>) {
  await requirePermission(workspaceId, caller.uid, "manage_workspace");
  await adminDb().doc(`workspaces/${workspaceId}`).update({ paymentLink: input.paymentLink || null });
  return { ok: true };
}

export const merchantInput = z.object({
  merchantId: z
    .string()
    .trim()
    .regex(/^\d{8}$/),
  merchantKey: z.string().trim().min(1).max(64),
  passphrase: z.string().trim().min(1).max(32),
  sandbox: z.boolean(),
  paymentLink: paymentLink.optional(),
});
export async function setMerchant(
  workspaceId: string,
  caller: Caller,
  input: z.infer<typeof merchantInput>,
) {
  await requirePermission(workspaceId, caller.uid, "manage_workspace");
  if (!/^\d{8}$/.test(input.merchantId) || !input.merchantKey.trim() || !input.passphrase.trim())
    throw badRequest("Enter your PayFast merchant ID, key and passphrase.");
  const encrypted = encryptKeys(
    {
      merchantId: input.merchantId,
      merchantKey: input.merchantKey,
      passphrase: input.passphrase,
    },
    workspaceId,
  );
  const merchant = {
    status: "verified",
    sandbox: input.sandbox,
    suffix: input.merchantKey.slice(-4),
  };
  const db = adminDb();
  await db.runTransaction(async (tx) => {
    tx.set(db.doc(`merchants/${workspaceId}`), {
      encrypted,
      sandbox: input.sandbox,
    });
    tx.update(db.doc(`workspaces/${workspaceId}`), {
      merchant,
      ...(input.paymentLink !== undefined ? { paymentLink: input.paymentLink || null } : {}),
    });
    audit(tx, workspaceId, {
      actorUid: caller.uid,
      action: "merchant.connect",
      target: workspaceId,
    });
  });
}
