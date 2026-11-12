import { optionalCaller } from "@/server/auth";
import { clientIp, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { createWeeklyDate, weeklyDateInput } from "@/server/weekly-dates";

export const POST = route(async (req: Request) => {
  await rateLimit("date.create", clientIp(req), 5, 3600);
  return createWeeklyDate(weeklyDateInput.parse(await req.json()), await optionalCaller(req));
});
