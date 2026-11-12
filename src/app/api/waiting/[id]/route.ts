import { waitingStatus } from "@/server/booking";
import { route } from "@/server/http";
export const GET = route(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) =>
    waitingStatus(
      (await params).id,
      new URL(req.url).searchParams.get("t") ?? "",
    ),
);
