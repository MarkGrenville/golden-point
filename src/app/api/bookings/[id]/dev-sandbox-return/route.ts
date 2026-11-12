import { z } from "zod";
import { clientIp, route } from "@/server/http";
import { devSandboxEnabled } from "@/server/dev-sandbox";
import { forbidden } from "@/server/errors";
import { confirmDevSandboxReturn } from "@/server/payments";
import { rateLimit } from "@/server/rate-limit";

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  // Reject before touching Firestore in production, even for a forged browser request.
  if (!devSandboxEnabled()) throw forbidden("DEV ONLY — return confirmation is disabled.");
  const { id } = await params;
  z.string().regex(/^[\w-]{1,100}$/).parse(id);
  await rateLimit("dev-sandbox-return", clientIp(req), 20);
  const { token, nonce } = z.object({ token: z.string().min(10).max(200), nonce: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await req.json());
  return confirmDevSandboxReturn(id, token, nonce);
});
