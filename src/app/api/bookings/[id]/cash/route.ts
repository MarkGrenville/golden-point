import { z } from "zod";
import { acceptCash } from "@/server/booking";
import { route } from "@/server/http";
export const POST = route(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { token } = z
      .object({ token: z.string().min(1) })
      .parse(await req.json());
    await acceptCash((await params).id, token);
    return { accepted: true };
  },
);
