import { hashSeed, seededRandom, shuffle } from "../shared/random";
import { courtsInUse, matchId } from "./americano";
import { computeStandings } from "./standings";
import type { Match, Participant, Round, Tournament } from "./types";

/**
 * Groups players (already in strength order) into consecutive fours. Within
 * each four the 1st and 4th partner against the 2nd and 3rd. Court 1 hosts the
 * first (strongest) group.
 */
function buildRound(number: number, ordered: readonly string[], resting: readonly string[]): Round {
  const matches: Match[] = [];
  for (let k = 0; 4 * k + 3 < ordered.length; k++) {
    const [p1, p2, p3, p4] = ordered.slice(4 * k, 4 * k + 4) as [string, string, string, string];
    matches.push({
      id: matchId(number, k + 1),
      round: number,
      court: k + 1,
      teamA: [p1, p4],
      teamB: [p2, p3],
      status: "scheduled",
      revision: 0,
    });
  }
  return { number, status: "draft", matches, resting: [...resting] };
}

export interface MexicanoFirstRoundInput {
  participants: readonly Participant[];
  courts: number;
  seed: number;
}

/**
 * Round 1. Without seeds the order is a seeded shuffle. If any participant has
 * a seed, seeded players come first by seed (lower is stronger; input order
 * breaks equal seeds) and unseeded players follow in shuffled order. Players
 * beyond the courts' capacity (the tail of that order) rest. Returned as a draft.
 */
export function generateMexicanoFirstRound(input: MexicanoFirstRoundInput): Round {
  const players = input.participants.filter((p) => p.active);
  if (players.length < 4) throw new Error("Mexicano needs at least 4 active players");
  const matches = courtsInUse(players.length, input.courts);
  if (matches < 1) throw new Error("At least one court is required");
  const rand = seededRandom(input.seed);
  const seeded = players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.seed !== undefined)
    .sort((a, b) => a.p.seed! - b.p.seed! || a.i - b.i)
    .map(({ p }) => p.id);
  const unseeded = shuffle(
    players.filter((p) => p.seed === undefined).map((p) => p.id),
    rand,
  );
  const order = [...seeded, ...unseeded];
  return buildRound(1, order.slice(0, 4 * matches), order.slice(4 * matches));
}

/**
 * Next round from the current standings. Requires every match of the latest
 * round to be completed or void.
 *
 * Rests: players who have sat out the fewest rounds rest first (rounds before
 * a late entrant joined count as sat out, so newcomers are not benched on
 * arrival). Ties among the fewest-rest group are broken by a stable seeded
 * shuffle (tournament seed + round number) rather than by ranking, so resting
 * is not a reward or penalty for form and the result is reproducible.
 *
 * Everyone else is taken in ranking order, grouped in consecutive fours and
 * paired 1st+4th vs 2nd+3rd; court 1 is the top group. Repeat partners are allowed.
 * Returned as a draft.
 */
export function generateMexicanoNextRound(tournament: Tournament): Round {
  const played = tournament.rounds.filter((r) => r.status !== "draft");
  const last = played[played.length - 1];
  if (!last) throw new Error("Round 1 has not been generated yet");
  const pending = last.matches.filter((m) => m.status === "scheduled");
  if (pending.length > 0) {
    throw new Error(`Round ${last.number} still has ${pending.length} match(es) without a result`);
  }
  const number = last.number + 1;
  const active = tournament.participants.filter((p) => p.active);
  if (active.length < 4) throw new Error("Mexicano needs at least 4 active players");
  const matches = courtsInUse(active.length, tournament.rules.courts);
  const restCount = active.length - 4 * matches;

  const satOut = new Map<string, number>(active.map((p) => [p.id, 0]));
  for (const round of played) {
    const playing = new Set(round.matches.flatMap((m) => [...m.teamA, ...m.teamB]));
    for (const p of active) if (!playing.has(p.id)) satOut.set(p.id, satOut.get(p.id)! + 1);
  }
  const tieOrder = new Map(
    shuffle(
      active.map((p) => p.id),
      seededRandom(hashSeed(`${tournament.seed}:mexicano:${number}`)),
    ).map((id, i) => [id, i]),
  );
  const resting = new Set(
    active
      .map((p) => p.id)
      .sort((a, b) => satOut.get(a)! - satOut.get(b)! || tieOrder.get(a)! - tieOrder.get(b)!)
      .slice(0, restCount),
  );

  const activeIds = new Set(active.map((p) => p.id));
  const ranked = computeStandings(tournament)
    .map((r) => r.participantId)
    .filter((id) => activeIds.has(id) && !resting.has(id));
  const restingList = active.map((p) => p.id).filter((id) => resting.has(id));
  return buildRound(number, ranked, restingList);
}
