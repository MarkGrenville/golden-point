import { z } from "zod";
import { adminDb } from "@/server/admin";
import { requireCaller } from "@/server/auth";
import { claimBookings, myBookings } from "@/server/booking";
import { route } from "@/server/http";
import { myTournaments } from "@/server/tournaments";

import { savedPlayers, savePlayers, savedPlayersInput } from "@/server/saved-players";

const ops = z.discriminatedUnion("op", [
  z.object({ op: z.literal("players") }),
  z.object({ op: z.literal("players.save"), names: savedPlayersInput }),
  z.object({ op: z.literal("bookings") }),
  z.object({ op: z.literal("claim") }),
  z.object({ op: z.literal("tournaments") }),
  z.object({ op: z.literal("notifications") }),
  z.object({ op: z.literal("pushToken"), token: z.string().min(10).max(4096) }),
]);

export const POST = route(async (req: Request) => {
  const caller = await requireCaller(req);
  const body = ops.parse(await req.json());
  switch (body.op) {
    case "players": return savedPlayers(caller);
    case "players.save": return savePlayers(caller, body.names);
    case "bookings": return myBookings(caller);
    case "claim": return claimBookings(caller);
    case "tournaments": return myTournaments(caller);
    case "notifications": {
      const snap = await adminDb().collection("notifications").where("uid", "==", caller.uid).orderBy("createdAt", "desc").limit(30).get();
      return snap.docs.map((d) => d.data());
    }
    case "pushToken": {
      const ref = adminDb().doc(`pushTokens/${caller.uid}`);
      const tokens = ((await ref.get()).data()?.tokens ?? []) as string[];
      await ref.set({ tokens: [...new Set([...tokens, body.token])].slice(-5) });
      return { ok: true };
    }
  }
});
