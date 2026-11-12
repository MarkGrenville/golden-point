import type { Transaction } from "firebase-admin/firestore";
import type { AuditEvent } from "@/lib/booking/types";
import { adminDb } from "./admin";

export function audit(tx: Transaction | null, workspaceId: string | null, event: Omit<AuditEvent, "at"> & { at?: string }) {
  const ref = adminDb().collection("audit").doc();
  const doc = { workspaceId, ...event, at: event.at ?? new Date().toISOString() };
  return tx ? tx.set(ref, doc) : ref.set(doc);
}
