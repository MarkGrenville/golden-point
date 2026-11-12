import { z } from "zod";
import { requireCaller } from "@/server/auth";
import { route } from "@/server/http";
import { claimWeeklyDate } from "@/server/weekly-dates";

export const POST = route(async (req: Request, context: { params: Promise<{ id: string }> }) => {
  const caller = await requireCaller(req);
  const { id } = await context.params;
  const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await req.json());
  return claimWeeklyDate(id, token, caller);
});
