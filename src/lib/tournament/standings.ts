import type { StandingRow, Tournament } from "./types";

interface Tally {
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  rests: number;
}

function emptyTally(): Tally {
  return { points: 0, played: 0, wins: 0, draws: 0, losses: 0, rests: 0 };
}

/**
 * Individual standings. Each player receives their team's points for every
 * completed match. Void and unplayed matches count nothing. Rests are counted
 * from published/completed rounds and award no points.
 *
 * Ranking:
 *  1. If every ranked player has the same number of appearances, total points;
 *     otherwise points per match (so rests, late arrivals and departures don't
 *     distort the table).
 *  2. Win rate, where a draw counts as half a win.
 *  3. Anything still level shares the rank (`tied: true`); display order among
 *     tied rows is by name, then id, for stability.
 *
 * Departed players keep their results (`active: false`) if they played; players
 * who never played and are no longer active are omitted.
 */
export function computeStandings(tournament: Tournament): StandingRow[] {
  const tallies = new Map<string, Tally>();
  const tally = (id: string): Tally => {
    let t = tallies.get(id);
    if (!t) {
      t = emptyTally();
      tallies.set(id, t);
    }
    return t;
  };

  for (const round of tournament.rounds) {
    if (round.status === "draft") continue;
    for (const id of round.resting) tally(id).rests += 1;
    for (const match of round.matches) {
      if (match.status !== "completed" || !match.result) continue;
      const { scoreA, scoreB } = match.result;
      for (const [team, own, other] of [
        [match.teamA, scoreA, scoreB],
        [match.teamB, scoreB, scoreA],
      ] as const) {
        for (const id of team) {
          const t = tally(id);
          t.points += own;
          t.played += 1;
          if (own > other) t.wins += 1;
          else if (own === other) t.draws += 1;
          else t.losses += 1;
        }
      }
    }
  }

  const rows: StandingRow[] = [];
  for (const p of tournament.participants) {
    const t = tallies.get(p.id) ?? emptyTally();
    if (!p.active && t.played === 0) continue;
    const eligible = p.joinedRound === 1 || tournament.rules.lateEntrantsEligibleToWin;
    rows.push({
      participantId: p.id,
      name: p.name,
      points: t.points,
      played: t.played,
      wins: t.wins,
      draws: t.draws,
      losses: t.losses,
      rests: t.rests,
      pointsPerMatch: t.played ? t.points / t.played : 0,
      winRate: t.played ? (t.wins + t.draws / 2) / t.played : 0,
      rank: 0,
      tied: false,
      eligible,
      active: p.active,
    });
  }

  const equalAppearances = rows.every((r) => r.played === rows[0]?.played);

  // Exact rational comparisons (cross-multiplication) so 24/2 and 36/3 compare equal.
  const primary = (a: StandingRow, b: StandingRow): number => {
    if (equalAppearances) return b.points - a.points;
    if (a.played && b.played) return b.points * a.played - a.points * b.played;
    // Players with no matches yet sort below anyone who has played.
    if (a.played || b.played) return a.played ? -1 : 1;
    return 0;
  };
  const winRate = (a: StandingRow, b: StandingRow): number => {
    if (!a.played || !b.played) return 0;
    return (2 * b.wins + b.draws) * a.played - (2 * a.wins + a.draws) * b.played;
  };
  const rankCompare = (a: StandingRow, b: StandingRow): number => primary(a, b) || winRate(a, b);

  rows.sort(
    (a, b) =>
      rankCompare(a, b) ||
      a.name.localeCompare(b.name) ||
      (a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0),
  );

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const prev = rows[i - 1];
    if (prev && rankCompare(prev, row) === 0) {
      row.rank = prev.rank;
      row.tied = true;
      prev.tied = true;
    } else {
      row.rank = i + 1;
    }
  }
  return rows;
}

/** Eligible rows sharing the best eligible rank (several on a shared first place). */
export function winners(standings: readonly StandingRow[]): StandingRow[] {
  const eligible = standings.filter((r) => r.eligible);
  if (eligible.length === 0) return [];
  const best = Math.min(...eligible.map((r) => r.rank));
  return eligible.filter((r) => r.rank === best);
}
