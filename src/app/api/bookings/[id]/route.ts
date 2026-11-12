import { optionalCaller } from "@/server/auth";
import { bookingStatus } from "@/server/booking";
import { clientIp, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

export const GET = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await rateLimit("booking", clientIp(req), 60);
  return bookingStatus(id, new URL(req.url).searchParams.get("t"), await optionalCaller(req));
});
