import { createHash } from "node:crypto";
import { adminDb } from "./admin";
import { HttpError } from "./errors";

/** Fixed-window limiter in Firestore so it holds across server instances. */
export async function rateLimit(key: string, ip: string | null, limit: number, windowSeconds = 60) {
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const id = createHash("sha256").update(`${key}|${ip ?? "unknown"}|${window}`).digest("hex").slice(0, 40);
  const ref = adminDb().doc(`rateLimits/${id}`);
  const count = await adminDb().runTransaction(async (tx) => {
    const n = ((await tx.get(ref)).data()?.count ?? 0) as number;
    // expiresAt lets a Firestore TTL policy clean these up; correctness does not depend on it.
    tx.set(ref, { count: n + 1, expiresAt: new Date((window + 2) * windowSeconds * 1000) });
    return n + 1;
  });
  if (count > limit) throw new HttpError(429, "Too many requests. Please wait a minute and try again.", "rate_limited");
}
