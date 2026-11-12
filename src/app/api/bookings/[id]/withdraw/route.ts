import { optionalCaller } from "@/server/auth";
import { withdraw } from "@/server/booking";
import { route } from "@/server/http";

/** Withdraws the caller's own place. There is no player-facing route that touches courts. */
export const POST = route(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    return withdraw(id, await optionalCaller(req), new Date(), body.token);
  },
);
