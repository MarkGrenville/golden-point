import { z } from "zod";
import { requireCaller, requirePermission } from "@/server/auth";
import { guestDateCaller } from "@/server/weekly-dates";
import { badRequest, forbidden } from "@/server/errors";
import { route } from "@/server/http";
import * as org from "@/server/organiser";
import {
  settle,
  manualPaymentInput,
  recordManualPayment,
} from "@/server/payments";
import { adminDb } from "@/server/admin";

/**
 * Organiser RPC. Every operation authenticates the caller and checks workspace
 * permissions explicitly inside the server module it calls.
 */
const ops = z.discriminatedUnion("op", [
  z.object({ op: z.literal("workspaces.mine") }),
  z.object({ op: z.literal("workspace.create"), name: z.string().min(1) }),
  z.object({ op: z.literal("workspace.overview"), workspaceId: z.string() }),
  z.object({
    op: z.literal("workspace.member"),
    workspaceId: z.string(),
    email: z.string().email(),
    role: z.enum(["organiser", "scorer"]).nullable(),
  }),
  z.object({ op: z.literal("payments.get"), workspaceId: z.string() }),
  z.object({ op: z.literal("payments.link"), workspaceId: z.string(), settings: org.paymentLinkInput }),
  z.object({
    op: z.literal("merchant.set"),
    workspaceId: z.string(),
    merchant: org.merchantInput,
  }),
  z.object({
    op: z.literal("group.create"),
    workspaceId: z.string(),
    group: org.groupInput,
  }),
  z.object({ op: z.literal("group.drafts"), groupId: z.string() }),
  z.object({
    op: z.literal("event.create"),
    groupId: z.string(),
    event: org.eventInput,
  }),
  z.object({ op: z.literal("event.dashboard"), eventId: z.string() }),
  z.object({
    op: z.literal("event.update"),
    eventId: z.string(),
    patch: org.eventPatch,
  }),
  z.object({ op: z.literal("event.publish"), eventId: z.string() }),
  z.object({
    op: z.literal("event.cancel"),
    eventId: z.string(),
    reason: z.string().min(3),
  }),
  z.object({
    op: z.literal("registration.manualPayment"),
    registrationId: z.string(),
    payment: manualPaymentInput,
  }),
  z.object({
    op: z.literal("registration.settle"),
    registrationId: z.string(),
  }),
]);

async function workspaceOf(collection: string, id: string): Promise<string> {
  const data = (await adminDb().doc(`${collection}/${id}`).get()).data();
  if (!data) throw badRequest("Not found");
  if (collection === "waitlist") return workspaceOf("events", data.eventId);
  return data.workspaceId;
}

export const POST = route(async (req: Request) => {
  const raw = await req.json();
  const body = ops.parse(raw);
  let caller;
  if (raw.guestToken) {
    // Capabilities only grant date administration; never merchant, membership or account access.
    if (!["event.dashboard", "event.update", "event.cancel", "registration.manualPayment", "registration.settle"].includes(body.op)) throw forbidden();
    const eventId = "registrationId" in body
      ? (await adminDb().doc(`registrations/${body.registrationId}`).get()).data()?.eventId
      : "eventId" in body ? body.eventId : null;
    if (typeof eventId !== "string" || typeof raw.guestToken !== "string") throw forbidden();
    caller = await guestDateCaller(eventId, raw.guestToken);
    if (body.op === "event.update" && Object.keys(body.patch).some((k) => k !== "dropOutBefore")) throw forbidden();
  } else {
    caller = await requireCaller(req);
  }
  switch (body.op) {
    case "workspaces.mine":
      return org.myWorkspaces(caller);
    case "workspace.create":
      return org.createWorkspace(caller, body.name);
    case "workspace.overview":
      return org.workspaceOverview(body.workspaceId, caller);
    case "workspace.member":
      return org.setMember(body.workspaceId, caller, body.email, body.role);
    case "payments.get":
      return org.paymentSettings(body.workspaceId, caller);
    case "payments.link":
      return org.setPaymentLink(body.workspaceId, caller, body.settings);
    case "merchant.set":
      return org.setMerchant(body.workspaceId, caller, body.merchant);
    case "group.create":
      return org.createGroup(body.workspaceId, caller, body.group);
    case "group.drafts":
      return org.generateDrafts(body.groupId, caller);
    case "event.create":
      return org.createEvent(body.groupId, caller, body.event);
    case "event.dashboard":
      return org.eventDashboard(body.eventId, caller);
    case "event.update":
      return org.updateEvent(body.eventId, caller, body.patch);
    case "event.publish":
      return org.publishEvent(body.eventId, caller);
    case "event.cancel":
      return org.cancelEvent(body.eventId, body.reason, caller);
    case "registration.manualPayment":
      await requirePermission(
        await workspaceOf("registrations", body.registrationId),
        caller.uid,
        "manage_payments",
      );
      return recordManualPayment(body.registrationId, body.payment, caller.uid);
    case "registration.settle":
      await requirePermission(
        await workspaceOf("registrations", body.registrationId),
        caller.uid,
        "manage_payments",
      );
      return settle(body.registrationId, caller.uid);
  }
});
