import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { TournamentError } from "@/lib/tournament";
import { HttpError } from "./errors";

/** Wrap a route handler: maps domain errors to JSON responses without leaking internals. */
export function route<A extends unknown[]>(handler: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    try {
      const result = await handler(...args);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      if (err instanceof ZodError) return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
      if (err instanceof TournamentError) {
        const status = err.name === "RevisionConflictError" ? 409 : 400;
        return NextResponse.json({ error: err.message, code: err.name }, { status });
      }
      console.error(err);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
}
