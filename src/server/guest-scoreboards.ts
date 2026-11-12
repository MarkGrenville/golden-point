import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { adminDb } from "./admin";
import { conflict, forbidden } from "./errors";

const name = z.string().min(1).max(40);
const count = z.number().int().min(0).max(10000);
const score = z.number().int().min(0).max(32).nullable();

/** Whitelist public fields rather than accepting a private tournament document. */
export const guestScoreboardInput = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  board: z.object({
    name: z.string().min(1).max(80),
    status: z.enum(["setup", "running", "finished"]),
    rules: z.object({
      format: z.enum(["americano", "mexicano"]),
      pointsPerMatch: z.union([z.literal(16), z.literal(24), z.literal(32)]),
      rounds: z.number().int().min(1).max(40),
      courts: z.number().int().min(1).max(8),
      minutesPerRound: z.number().int().min(5).max(60),
      lateEntrantsEligibleToWin: z.boolean(),
    }),
    revision: count,
    rounds: z
      .array(
        z.object({
          number: z.number().int().min(1).max(40),
          status: z.enum(["published", "completed"]),
          resting: z.array(name).max(32),
          matches: z
            .array(
              z.object({
                id: z.string().min(1).max(100),
                court: z.number().int().min(1).max(8),
                teamA: z.tuple([name, name]),
                teamB: z.tuple([name, name]),
                status: z.enum(["scheduled", "completed", "void"]),
                scoreA: score,
                scoreB: score,
              }),
            )
            .max(8),
        }),
      )
      .max(40),
    standings: z
      .array(
        z.object({
          name,
          points: count,
          played: count,
          wins: count,
          draws: count,
          losses: count,
          rests: count,
          rank: count,
          pointsPerMatch: z.number().min(0).max(32),
          winRate: z.number().min(0).max(1),
          tied: z.boolean(),
          eligible: z.boolean(),
          active: z.boolean(),
        }),
      )
      .max(32),
  }),
});

export const guestScoreboardId = z.string().regex(/^guest-[a-f0-9-]{36}$/);

/** Only the phone holding the private token can publish; spectators get names/results. */
export async function publishGuestScoreboard(
  id: string,
  input: z.infer<typeof guestScoreboardInput>,
) {
  guestScoreboardId.parse(id);
  const { token, board } = guestScoreboardInput.parse(input);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const db = adminDb();
  const ownerRef = db.doc(`guestScoreboards/${id}`);
  const publicRef = db.doc(`publicScoreboards/${id}`);
  return db.runTransaction(async (tx) => {
    const [owner, existing] = await Promise.all([
      tx.get(ownerRef),
      tx.get(publicRef),
    ]);
    if (owner.exists) {
      const stored = Buffer.from(owner.data()!.tokenHash, "hex");
      if (
        stored.length !== 32 ||
        !timingSafeEqual(stored, Buffer.from(tokenHash, "hex"))
      )
        throw forbidden(
          "Only the organiser's phone can update this scoreboard.",
        );
      // Offline retries and out-of-order requests cannot roll the public board back.
      if (existing.exists && existing.data()!.revision >= board.revision)
        return { id, revision: existing.data()!.revision as number };
    } else {
      if (existing.exists)
        throw conflict("This scoreboard link is already in use.");
      tx.create(ownerRef, { tokenHash });
    }
    tx.set(publicRef, { ...board, id, updatedAt: new Date().toISOString() });
    return { id, revision: board.revision };
  });
}
