import { ROLE_PERMISSIONS, type Permission, type Role, type Workspace } from "@/lib/booking/types";
import { adminAuth, adminDb } from "./admin";
import { forbidden, notFound, unauthorized } from "./errors";

export interface Caller {
  uid: string;
  email?: string;
  emailVerified: boolean;
}

export async function optionalCaller(req: Request): Promise<Caller | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const token = await adminAuth().verifyIdToken(header.slice(7));
    return { uid: token.uid, email: token.email?.toLowerCase(), emailVerified: !!token.email_verified };
  } catch {
    throw unauthorized("Your session has expired; sign in again.");
  }
}

export async function requireCaller(req: Request): Promise<Caller> {
  const caller = await optionalCaller(req);
  if (!caller) throw unauthorized();
  return caller;
}

export function roleAllows(role: Role | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}

/** Explicit membership check: the Admin SDK bypasses security rules, so every server path calls this. */
export async function requirePermission(workspaceId: string, uid: string, permission: Permission): Promise<Workspace> {
  const snap = await adminDb().doc(`workspaces/${workspaceId}`).get();
  if (!snap.exists) throw notFound("Workspace not found");
  const ws = snap.data() as Workspace;
  if (!roleAllows(ws.members[uid], permission)) throw forbidden();
  return ws;
}
