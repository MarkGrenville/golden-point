import { z } from "zod";
import { requireCaller } from "@/server/auth";
import { route } from "@/server/http";
import { actionInput, addScorer, applyAction, getTournament } from "@/server/tournaments";

export const GET = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  return getTournament((await params).id, await requireCaller(req));
});

const body = z.union([z.object({ action: actionInput }), z.object({ addScorer: z.string().email() })]);

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const caller = await requireCaller(req);
  const b = body.parse(await req.json());
  if ("addScorer" in b) return addScorer(id, caller, b.addScorer);
  return { tournament: await applyAction(id, caller, b.action) };
});
