import {
  guestScoreboardInput,
  publishGuestScoreboard,
} from "@/server/guest-scoreboards";
import { badRequest } from "@/server/errors";
import { clientIp, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

/** No account required. The private write token stays on the organiser's phone. */
export const PUT = route(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    await rateLimit("guest-scoreboard", clientIp(req), 120);
    const raw = await req.text();
    if (raw.length > 200_000) throw badRequest("This scoreboard is too large.");
    let parsed: unknown;
  try {parsed = JSON.parse(raw);} catch {throw badRequest("Invalid scoreboard JSON.");}
  const input = guestScoreboardInput.parse(parsed);
    return publishGuestScoreboard((await params).id, input);
  },
);
