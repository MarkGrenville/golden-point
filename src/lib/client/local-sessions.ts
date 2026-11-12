"use client";
import { goldenPointStorage } from "./storage";
import type { Tournament } from "@/lib/tournament";

/** Standalone sessions saved only in this browser. Distinct from sessions saved online. */
const PREFIX = "golden-point.tournament.";

export function saveLocal(t: Tournament) {
  goldenPointStorage().setItem(PREFIX + t.id, JSON.stringify({ savedAt: new Date().toISOString(), tournament: t }));
}

export function loadLocal(id: string): { savedAt: string; tournament: Tournament } | null {
  const raw = goldenPointStorage().getItem(PREFIX + id);
  return raw ? JSON.parse(raw) : null;
}

export function listLocal(): { id: string; name: string; status: string; savedAt: string }[] {
  const out = [];
  for (let i = 0; i < goldenPointStorage().length; i++) {
    const key = goldenPointStorage().key(i)!;
    if (!key.startsWith(PREFIX)) continue;
    try {
      const { savedAt, tournament } = JSON.parse(goldenPointStorage().getItem(key)!);
      out.push({ id: tournament.id, name: tournament.name, status: tournament.status, savedAt });
    } catch {
      /* ignore corrupt entries */
    }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function removeLocal(id: string) {
  goldenPointStorage().removeItem(PREFIX + id);
}

/** Score drafts entered while offline for a cloud session. Never used to draw a new round. */
const PENDING = "golden-point.pending.";
export type PendingScore = { matchId: string; expectedMatchRevision: number; scoreA: number; scoreB: number };

export function loadPending(id: string): PendingScore[] {
  return JSON.parse(goldenPointStorage().getItem(PENDING + id) ?? "[]");
}
export function savePending(id: string, items: PendingScore[]) {
  if (items.length) goldenPointStorage().setItem(PENDING + id, JSON.stringify(items));
  else goldenPointStorage().removeItem(PENDING + id);
}
