import { clientIp } from "@/server/http";
import { handleItn } from "@/server/payments";

/** PayFast posts here. Always read the raw body: the signature depends on exact field order. */
export async function POST(req: Request) {
  try {
    const { status, effect } = await handleItn(await req.text(), clientIp(req));
    return new Response(effect, { status });
  } catch (err) {
    console.error("ITN failed", err);
    // A 500 makes PayFast retry, which is what we want for transient failures.
    return new Response("error", { status: 500 });
  }
}
