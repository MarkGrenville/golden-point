import { computeStandings } from "./standings";
import type { StandingRow, Tournament, TournamentRules } from "./types";

/** Read-only public projection: names and results only — no financial status or registration links. */
export interface Scoreboard {
  id: string;
  name: string;
  status: Tournament["status"];
  rules: TournamentRules;
  revision: number;
  rounds: {
    number: number;
    status: string;
    resting: string[];
    matches: { id: string; court: number; teamA: [string, string]; teamB: [string, string]; status: string; scoreA: number | null; scoreB: number | null }[];
  }[];
  standings: Omit<StandingRow, "participantId">[];
  updatedAt: string;
}

export function toScoreboard(t: Tournament, updatedAt: string): Scoreboard {
  const name = (id: string) => t.participants.find((p) => p.id === id)?.name ?? "?";
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    rules: t.rules,
    revision: t.revision,
    rounds: t.rounds
      .filter((r) => r.status !== "draft")
      .map((r) => ({
        number: r.number,
        status: r.status,
        resting: r.resting.map(name),
        matches: r.matches.map((m) => ({
          id: m.id,
          court: m.court,
          teamA: [name(m.teamA[0]), name(m.teamA[1])],
          teamB: [name(m.teamB[0]), name(m.teamB[1])],
          status: m.status,
          scoreA: m.result?.scoreA ?? null,
          scoreB: m.result?.scoreB ?? null,
        })),
      })),
    standings: computeStandings(t).map(({ participantId: _id, ...row }) => row),
    updatedAt,
  };
}
