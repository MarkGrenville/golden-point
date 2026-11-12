"use client";
import Link from "next/link";
import { PageHeading } from "./PageHeading";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/client/auth";
import { sastInstant, TIME_ZONE } from "@/lib/shared/time";

/** <input type="datetime-local"> values are SAST wall-clock times. */
export function fromLocalInput(v: string): string {
  const [d, t] = v.split("T");
  return sastInstant(d!, t!.slice(0, 5)).toISOString();
}

export function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (k: string) => parts.find((p) => p.type === k)!.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

export const randsToCents = (v: string) => Math.round(Number(v || "0") * 100);

export function RequireSignIn({ next, children }: { next: string; children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <main><p>Loading…</p></main>;
  if (!user) return <main className="stack"><PageHeading eyebrow="Organisers" title="Your organiser clubhouse" /><p>Sign in to manage your groups, dates and tournaments.</p><Link className="button full" href={`/signin?next=${encodeURIComponent(next)}`}>Sign in</Link></main>;
  return <>{children}</>;
}
