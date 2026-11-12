import { z } from "zod";
import { isFunded } from "@/lib/booking/rules";
import type { EventDate, Registration, Workspace } from "@/lib/booking/types";
import { randomSeed } from "@/lib/shared/random";
import {
  applyTournamentAction,
  createTournament,
  DIRECTOR_ACTIONS,
  toScoreboard,
  TournamentError,
  type ParticipantFinancialStatus,
  type Tournament,
} from "@/lib/tournament";
import { adminAuth, adminDb } from "./admin";
import { audit } from "./audit";
import { roleAllows, type Caller } from "./auth";
import { badRequest, conflict, forbidden, notFound } from "./errors";

interface TournamentDoc {
  ownerUid: string;
  workspaceId: string | null;
  scorers: string[];
  tournament: Tournament;
  updatedAt: string;
}

const financial = z.enum(["paid_online", "paid_externally", "cash_received", "fee_waived", "unpaid_exception", "not_applicable"]);

const rulesInput = z.object({
  format: z.enum(["americano", "mexicano"]),
  pointsPerMatch: z.union([z.literal(16), z.literal(24), z.literal(32)]).default(24),
  rounds: z.number().int().min(1).max(40),
  courts: z.number().int().min(1).max(8),
  minutesPerRound: z.number().int().min(5).max(60).default(15),
  lateEntrantsEligibleToWin: z.boolean().default(false),
});

export const createInput = z.object({
  name: z.string().trim().min(1).max(80),
  rules: rulesInput,
  participants: z.array(z.object({ name: z.string().trim().min(1).max(40), seed: z.number().optional(), financialStatus: financial.optional() })).max(32),
  eventId: z.string().optional(),
  poolId: z.string().optional(),
});

const MAP_PAYMENT: Record<string, ParticipantFinancialStatus> = {
  paid_online: "paid_online",
  paid_externally: "paid_externally",
  cash_received: "cash_received",
  fee_waived: "fee_waived",
};

async function canManageWorkspace(workspaceId: string | null, uid: string, permission: "score" | "manage_events") {
  if (!workspaceId) return false;
  const ws = (await adminDb().doc(`workspaces/${workspaceId}`).get()).data() as Workspace | undefined;
  return roleAllows(ws?.members[uid], permission);
}

/**
 * Create a cloud session — standalone, or seeded from a paid event's active registrations.
 * Manual additions carry their own financial status; nothing fabricates a payment.
 */
export async function createCloudTournament(caller: Caller, input: z.infer<typeof createInput>) {
  const db = adminDb();
  let workspaceId: string | null = null;
  const participants: { name: string; seed?: number; financialStatus?: ParticipantFinancialStatus; registrationId?: string }[] = [];
  if (input.eventId) {
    const event = (await db.doc(`events/${input.eventId}`).get()).data() as EventDate | undefined;
    if (!event) throw notFound("Date not found");
    if (!(await canManageWorkspace(event.workspaceId, caller.uid, "manage_events"))) throw forbidden();
    workspaceId = event.workspaceId;
    const regs = await db.collection("registrations").where("eventId", "==", input.eventId).where("attendance", "==", "active").get();
    for (const doc of regs.docs) {
      const r = doc.data() as Registration;
      if (input.poolId && r.poolId !== input.poolId) continue;
      if (!isFunded(r)) continue;
      participants.push({ name: r.alias || r.displayName, financialStatus: MAP_PAYMENT[r.payment], registrationId: r.id });
    }
  }
  for (const p of input.participants) participants.push({ ...p, financialStatus: p.financialStatus ?? (input.eventId ? "unpaid_exception" : "not_applicable") });
  if (input.eventId && input.participants.some((p) => !p.financialStatus)) {
    throw badRequest("Record each added player's financial status: paid externally, cash received, fee waived or an accepted unpaid exception.");
  }
  const ref = db.collection("tournaments").doc();
  const now = new Date().toISOString();
  const t = createTournament({ id: ref.id, name: input.name, rules: input.rules, participants, seed: randomSeed(), now, eventId: input.eventId, actor: caller.uid });
  const doc: TournamentDoc = { ownerUid: caller.uid, workspaceId, scorers: [], tournament: t, updatedAt: now };
  await db.runTransaction(async (tx) => {
    tx.set(ref, doc);
    tx.set(db.doc(`publicScoreboards/${ref.id}`), toScoreboard(t, now));
  });
  return t;
}

/** Upload a locally saved standalone session so it can be shared and scored from other devices. */
export async function importLocalTournament(caller: Caller, t: Tournament) {
  if (t.eventId) throw badRequest("Event tournaments are created online.");
  const ids = new Set(t.participants.map((p) => p.id));
  for (const r of t.rounds) {
    const seen = new Set<string>();
    for (const m of r.matches) {
      for (const id of [...m.teamA, ...m.teamB]) {
        if (!ids.has(id) || seen.has(id)) throw badRequest("This session's rounds are inconsistent and cannot be uploaded.");
        seen.add(id);
      }
    }
  }
  const db = adminDb();
  const ref = db.collection("tournaments").doc();
  const now = new Date().toISOString();
  const uploaded: Tournament = { ...t, id: ref.id, audit: [...t.audit, { at: now, actor: caller.uid, action: "uploaded_from_local" }], revision: t.revision + 1 };
  await db.runTransaction(async (tx) => {
    tx.set(ref, { ownerUid: caller.uid, workspaceId: null, scorers: [], tournament: uploaded, updatedAt: now } satisfies TournamentDoc);
    tx.set(db.doc(`publicScoreboards/${ref.id}`), toScoreboard(uploaded, now));
  });
  return uploaded;
}

async function access(doc: TournamentDoc, uid: string) {
  if (doc.ownerUid === uid) return "director" as const;
  if (await canManageWorkspace(doc.workspaceId, uid, "manage_events")) return "director" as const;
  if (doc.scorers.includes(uid) || (await canManageWorkspace(doc.workspaceId, uid, "score"))) return "scorer" as const;
  return null;
}

export async function getTournament(id: string, caller: Caller) {
  const doc = (await adminDb().doc(`tournaments/${id}`).get()).data() as TournamentDoc | undefined;
  if (!doc) throw notFound("Tournament not found");
  const role = await access(doc, caller.uid);
  if (!role) throw forbidden();
  return { tournament: doc.tournament, role };
}

export const actionInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), expectedRevision: z.number().int() }),
  z.object({ type: z.literal("publish_next"), expectedRevision: z.number().int() }),
  z.object({ type: z.literal("regenerate_round"), expectedRevision: z.number().int() }),
  z.object({ type: z.literal("finish"), expectedRevision: z.number().int() }),
  z.object({ type: z.literal("result"), matchId: z.string(), expectedMatchRevision: z.number().int(), scoreA: z.number(), scoreB: z.number(), reason: z.string().max(200).optional() }),
  z.object({ type: z.literal("void"), matchId: z.string(), expectedMatchRevision: z.number().int(), reason: z.string().min(3).max(200) }),
  z.object({ type: z.literal("add_player"), expectedRevision: z.number().int(), name: z.string().trim().min(1).max(40), financialStatus: financial }),
  z.object({ type: z.literal("withdraw_player"), expectedRevision: z.number().int(), participantId: z.string() }),
  z.object({ type: z.literal("check_in"), participantId: z.string(), checkedIn: z.boolean() }),
  z.object({ type: z.literal("update_setup"), expectedRevision: z.number().int(), name: z.string().optional(), rules: rulesInput.partial().optional() }),
]);


/**
 * Server-confirmed mutation using the same pure engine as local sessions. Structural
 * actions check the whole-document revision; scores check the match revision so two
 * scorers on different courts don't block each other but cannot overwrite the same match.
 */
export async function applyAction(id: string, caller: Caller, action: z.infer<typeof actionInput>) {
  const db = adminDb();
  const ref = db.doc(`tournaments/${id}`);
  return db.runTransaction(async (tx) => {
    const doc = (await tx.get(ref)).data() as TournamentDoc | undefined;
    if (!doc) throw notFound("Tournament not found");
    const role = await access(doc, caller.uid);
    if (!role) throw forbidden();
    if (DIRECTOR_ACTIONS.has(action.type) && role !== "director") throw forbidden("Only the director can do that.");
    const now = new Date().toISOString();
    let next: Tournament;
    try {
      next = applyTournamentAction(doc.tournament, action, { actor: caller.uid, now });
    } catch (err) {
      if (err instanceof TournamentError && /another device/.test(err.message)) throw conflict(err.message, "RevisionConflictError");
      throw err;
    }
    tx.update(ref, { tournament: next, updatedAt: now });
    tx.set(db.doc(`publicScoreboards/${id}`), toScoreboard(next, now));
    if (doc.workspaceId && (action.type === "start" || action.type === "finish")) {
      audit(tx, doc.workspaceId, { actorUid: caller.uid, action: `tournament.${action.type}`, target: id, detail: { rosterVersion: next.rosterVersion } });
    }
    return next;
  });
}

export async function addScorer(id: string, caller: Caller, email: string) {
  const db = adminDb();
  const ref = db.doc(`tournaments/${id}`);
  const user = await adminAuth().getUserByEmail(email.toLowerCase()).catch(() => null);
  if (!user) throw notFound("That person needs to sign in once before they can score.");
  await db.runTransaction(async (tx) => {
    const doc = (await tx.get(ref)).data() as TournamentDoc | undefined;
    if (!doc) throw notFound();
    if ((await access(doc, caller.uid)) !== "director") throw forbidden();
    if (!doc.scorers.includes(user.uid)) tx.update(ref, { scorers: [...doc.scorers, user.uid] });
  });
}

export async function myTournaments(caller: Caller) {
  const snap = await adminDb().collection("tournaments").where("ownerUid", "==", caller.uid).get();
  const scoring = await adminDb().collection("tournaments").where("scorers", "array-contains", caller.uid).get();
  return [...snap.docs, ...scoring.docs].map((d) => {
    const t = (d.data() as TournamentDoc).tournament;
    return { id: d.id, name: t.name, status: t.status, format: t.rules.format, createdAt: t.createdAt };
  });
}
