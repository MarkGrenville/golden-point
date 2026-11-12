import { z } from "zod";
import { requireCaller } from "@/server/auth";
import { route } from "@/server/http";
import { createCloudTournament, createInput, importLocalTournament } from "@/server/tournaments";
import type { Tournament } from "@/lib/tournament";

const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), input: createInput }),
  z.object({ op: z.literal("import"), tournament: z.record(z.string(), z.unknown()) }),
]);

export const POST = route(async (req: Request) => {
  const caller = await requireCaller(req);
  const b = body.parse(await req.json());
  return b.op === "create" ? createCloudTournament(caller, b.input) : importLocalTournament(caller, b.tournament as unknown as Tournament);
});
