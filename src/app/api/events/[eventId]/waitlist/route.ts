import { optionalCaller } from "@/server/auth";
import { joinWaitlist, waitlistInput } from "@/server/booking";
import { clientIp, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

export const POST = route(async (req: Request, { params }: { params: Promise<{ eventId: string }> }) => {
  const { eventId } = await params;
  await rateLimit("waitlist", clientIp(req), 10);
  return joinWaitlist(eventId, waitlistInput.parse(await req.json()), await optionalCaller(req));
});
