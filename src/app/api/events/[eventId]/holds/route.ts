import { optionalCaller } from "@/server/auth";
import { createHold, holdInput } from "@/server/booking";
import { clientIp, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

export const POST = route(async (req: Request, { params }: { params: Promise<{ eventId: string }> }) => {
  const { eventId } = await params;
  await rateLimit("hold", clientIp(req), 10);
  const caller = await optionalCaller(req);
  return createHold(eventId, holdInput.parse(await req.json()), caller);
});
