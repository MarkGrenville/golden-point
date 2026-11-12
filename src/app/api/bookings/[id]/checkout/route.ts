import { z } from "zod";
import { clientIp, route } from "@/server/http";
import { checkoutForm } from "@/server/payments";
import { rateLimit } from "@/server/rate-limit";

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await rateLimit("checkout", clientIp(req), 20);
  const { token } = z.object({ token: z.string().min(10) }).parse(await req.json());
  return checkoutForm(id, token);
});
