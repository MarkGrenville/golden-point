import { seededRandom, shuffle } from "../shared/random";
import type { Match, Round, SchedulePreview, TournamentRules } from "./types";

export interface AmericanoScheduleInput {
  participantIds: readonly string[];
  courts: number;
  /** Number of rounds to generate (excluding history). */
  rounds: number;
  seed: number;
  /**
   * Rounds already published/completed that must be preserved. Their partner,
   * opponent and rest counts are taken into account; only the remaining rounds
   * are generated, numbered after the last history round.
   */
  history?: readonly Round[];
}

/** Matches that fit on court for this many players. */
export function courtsInUse(players: number, courts: number): number {
  return Math.max(0, Math.min(courts, Math.floor(players / 4)));
}

/** Partner repeats are weighted far above opponent repeats. */
const PARTNER_WEIGHT = 1000;
/** Rough total budget of local-search move evaluations per schedule call. */
const MOVE_BUDGET = 300_000;
/** Whole-schedule hill-climbing moves applied to the best restart. */
const POLISH_MOVES = 200_000;

interface Counts {
  n: number;
  partner: Int32Array;
  opponent: Int32Array;
  /** Rounds a player did not play (rested, or not yet joined). */
  satOut: Int32Array;
  /** Round number the player last sat out (very negative if never). */
  lastSatOut: Float64Array;
}

function newCounts(n: number): Counts {
  return {
    n,
    partner: new Int32Array(n * n),
    opponent: new Int32Array(n * n),
    satOut: new Int32Array(n),
    lastSatOut: new Float64Array(n).fill(-1e9),
  };
}

function cloneCounts(c: Counts): Counts {
  return {
    n: c.n,
    partner: c.partner.slice(),
    opponent: c.opponent.slice(),
    satOut: c.satOut.slice(),
    lastSatOut: c.lastSatOut.slice(),
  };
}

function bump(arr: Int32Array, n: number, a: number, b: number): void {
  arr[a * n + b]! += 1;
  arr[b * n + a]! += 1;
}

/** Applies a round given as a flat arrangement [a,b,c,d, ...] = (a+b vs c+d), ... */
function applyArrangement(c: Counts, arr: readonly number[]): void {
  for (let k = 0; k + 3 < arr.length; k += 4) {
    const a = arr[k]!;
    const b = arr[k + 1]!;
    const x = arr[k + 2]!;
    const y = arr[k + 3]!;
    bump(c.partner, c.n, a, b);
    bump(c.partner, c.n, x, y);
    bump(c.opponent, c.n, a, x);
    bump(c.opponent, c.n, a, y);
    bump(c.opponent, c.n, b, x);
    bump(c.opponent, c.n, b, y);
  }
}

function countsFromHistory(ids: readonly string[], history: readonly Round[]): Counts {
  const n = ids.length;
  const c = newCounts(n);
  const index = new Map(ids.map((id, i) => [id, i]));
  const sorted = [...history].sort((a, b) => a.number - b.number);
  for (const round of sorted) {
    const playing = new Set<number>();
    for (const m of round.matches) {
      const a = index.get(m.teamA[0]);
      const b = index.get(m.teamA[1]);
      const x = index.get(m.teamB[0]);
      const y = index.get(m.teamB[1]);
      for (const p of [a, b, x, y]) if (p !== undefined) playing.add(p);
      if (a !== undefined && b !== undefined) bump(c.partner, n, a, b);
      if (x !== undefined && y !== undefined) bump(c.partner, n, x, y);
      for (const p of [a, b]) {
        for (const q of [x, y]) {
          if (p !== undefined && q !== undefined) bump(c.opponent, n, p, q);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (!playing.has(i)) {
        c.satOut[i]! += 1;
        c.lastSatOut[i] = round.number;
      }
    }
  }
  return c;
}

/** Marginal cost of one match given current counts. */
function matchCost(c: Counts, arr: readonly number[], k: number): number {
  const n = c.n;
  const a = arr[4 * k]!;
  const b = arr[4 * k + 1]!;
  const x = arr[4 * k + 2]!;
  const y = arr[4 * k + 3]!;
  return (
    PARTNER_WEIGHT * (c.partner[a * n + b]! + c.partner[x * n + y]!) +
    c.opponent[a * n + x]! +
    c.opponent[a * n + y]! +
    c.opponent[b * n + x]! +
    c.opponent[b * n + y]!
  );
}

/** Seeded local search over player positions in one round. */
function optimiseRound(c: Counts, playing: readonly number[], rand: () => number, iterations: number): number[] {
  const arr = shuffle(playing, rand);
  const len = arr.length;
  for (let it = 0; it < iterations; it++) {
    const i = Math.floor(rand() * len);
    const j = Math.floor(rand() * len);
    if (i >> 1 === j >> 1) continue; // same team: no-op
    const mi = i >> 2;
    const mj = j >> 2;
    const before = matchCost(c, arr, mi) + (mi !== mj ? matchCost(c, arr, mj) : 0);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    const after = matchCost(c, arr, mi) + (mi !== mj ? matchCost(c, arr, mj) : 0);
    if (after > before) [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Seeded local search assigning fixed partner pairs to matches (opponent balance only). */
function arrangePairs(
  c: Counts,
  pairs: readonly (readonly [number, number])[],
  rand: () => number,
  iterations: number,
): number[] {
  const order = shuffle(pairs, rand);
  const flat = (): number[] => order.flatMap((p) => [p[0], p[1]]);
  if (order.length <= 2) return flat();
  const n = c.n;
  const cost = (k: number): number => {
    const p = order[2 * k]!;
    const q = order[2 * k + 1]!;
    return (
      c.opponent[p[0] * n + q[0]]! +
      c.opponent[p[0] * n + q[1]]! +
      c.opponent[p[1] * n + q[0]]! +
      c.opponent[p[1] * n + q[1]]!
    );
  };
  const len = order.length;
  for (let it = 0; it < iterations; it++) {
    const i = Math.floor(rand() * len);
    const j = Math.floor(rand() * len);
    const mi = i >> 1;
    const mj = j >> 1;
    if (mi === mj) continue;
    const before = cost(mi) + cost(mj);
    [order[i], order[j]] = [order[j]!, order[i]!];
    const after = cost(mi) + cost(mj);
    if (after > before) [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return flat();
}

interface Plan {
  arrangements: number[][];
  resting: number[][];
  counts: Counts;
}

/** Lexicographic schedule quality: partner repeats, partner spread, opponent spread. */
function score(c: Counts): [number, number, number] {
  const n = c.n;
  let excess = 0;
  let partnerSq = 0;
  let opponentSq = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = c.partner[i * n + j]!;
      const o = c.opponent[i * n + j]!;
      if (p > 1) excess += p - 1;
      partnerSq += p * p;
      opponentSq += o * o;
    }
  }
  return [excess, partnerSq, opponentSq];
}

function better(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return false;
}

/** Picks who sits out: fewest sat-out rounds first, then longest since last rest, then seeded random. */
function chooseResting(c: Counts, restCount: number, rand: () => number): { resting: number[]; playing: number[] } {
  const keys = Array.from({ length: c.n }, () => rand());
  const order = Array.from({ length: c.n }, (_, i) => i).sort(
    (a, b) => c.satOut[a]! - c.satOut[b]! || c.lastSatOut[a]! - c.lastSatOut[b]! || keys[a]! - keys[b]!,
  );
  return { resting: order.slice(0, restCount).sort((a, b) => a - b), playing: order.slice(restCount) };
}

function greedyPlan(
  base: Counts,
  matches: number,
  rounds: number,
  firstRound: number,
  rand: () => number,
  iterations: number,
): Plan {
  const c = cloneCounts(base);
  const restCount = c.n - 4 * matches;
  const arrangements: number[][] = [];
  const resting: number[][] = [];
  for (let r = 0; r < rounds; r++) {
    const { resting: rest, playing } = chooseResting(c, restCount, rand);
    const arr = optimiseRound(c, playing, rand, iterations);
    applyArrangement(c, arr);
    for (const p of rest) {
      c.satOut[p]! += 1;
      c.lastSatOut[p] = firstRound + r;
    }
    arrangements.push(arr);
    resting.push(rest);
  }
  return { arrangements, resting, counts: c };
}

/**
 * Exact partner construction when everyone plays every round: the circle
 * method gives a 1-factorisation of K_n, so over n-1 rounds every pair
 * partners exactly once. Pairs are then assigned to courts by local search
 * to balance opponents.
 */
function circlePlan(base: Counts, rounds: number, rand: () => number, iterations: number): Plan {
  const c = cloneCounts(base);
  const n = c.n;
  const labels = shuffle(
    Array.from({ length: n }, (_, i) => i),
    rand,
  );
  const factors: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [[labels[n - 1]!, labels[r]!]];
    for (let k = 1; k < n / 2; k++) {
      pairs.push([labels[(r + k) % (n - 1)]!, labels[(r - k + n - 1) % (n - 1)]!]);
    }
    factors.push(pairs);
  }
  const factorOrder = shuffle(
    factors.map((_, i) => i),
    rand,
  );
  const arrangements: number[][] = [];
  const resting: number[][] = [];
  for (let r = 0; r < rounds; r++) {
    const pairs = factors[factorOrder[r % factors.length]!]!;
    const arr = arrangePairs(c, pairs, rand, iterations);
    applyArrangement(c, arr);
    arrangements.push(arr);
    resting.push([]);
  }
  return { arrangements, resting, counts: c };
}

const cyclicBaseCache = new Map<number, number[] | null>();

/**
 * Searches for a cyclic whist-style base round on Z_{n-1} ∪ {∞} (∞ = n-1):
 * a flat arrangement whose partner differences cover each ±d exactly once and
 * opponent differences each ±d exactly twice. Developing it (add r mod n-1)
 * gives n-1 rounds where every pair partners once and opposes twice.
 * Found for 8, 12 and 16 players; larger sizes keep the best partner-perfect
 * base found, if any. Search uses fixed seeds so results are deterministic and
 * cached per n.
 */
function cyclicBase(n: number): number[] | null {
  const cached = cyclicBaseCache.get(n);
  if (cached !== undefined) return cached;
  let result: number[] | null = null;
  if (n >= 8 && n <= 28 && n % 4 === 0) {
    const M = n - 1;
    const half = (n - 2) / 2;
    const diff = (a: number, b: number): number => {
      if (a === M || b === M) return 0;
      const x = (((a - b) % M) + M) % M;
      return Math.min(x, M - x);
    };
    const pc = new Int32Array(half + 1);
    const oc = new Int32Array(half + 1);
    let bestCost = Infinity;
    for (let attempt = 1; attempt <= 6 && bestCost > 0; attempt++) {
      const rand = seededRandom(n * 7919 + attempt);
      const arr = shuffle(
        Array.from({ length: n }, (_, i) => i),
        rand,
      );
      const cost = (): number => {
        pc.fill(0);
        oc.fill(0);
        for (let k = 0; k < n; k += 4) {
          const a = arr[k]!;
          const b = arr[k + 1]!;
          const x = arr[k + 2]!;
          const y = arr[k + 3]!;
          pc[diff(a, b)]! += 1;
          pc[diff(x, y)]! += 1;
          oc[diff(a, x)]! += 1;
          oc[diff(a, y)]! += 1;
          oc[diff(b, x)]! += 1;
          oc[diff(b, y)]! += 1;
        }
        let c = 0;
        for (let d = 1; d <= half; d++) c += PARTNER_WEIGHT * Math.abs(pc[d]! - 1) + Math.abs(oc[d]! - 2);
        return c;
      };
      let cur = cost();
      for (let it = 0; it < 20_000 && cur > 0; it++) {
        const i = Math.floor(rand() * n);
        const j = Math.floor(rand() * n);
        if (i >> 1 === j >> 1) continue;
        [arr[i], arr[j]] = [arr[j]!, arr[i]!];
        const c = cost();
        if (c <= cur) cur = c;
        else [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      }
      if (cur < PARTNER_WEIGHT && cur < bestCost) {
        bestCost = cur;
        result = [...arr];
      }
    }
  }
  cyclicBaseCache.set(n, result);
  return result;
}

/** Cyclic development of the base round, with seeded player labels and round order. */
function cyclicPlan(base: Counts, baseRound: readonly number[], rounds: number, rand: () => number): Plan {
  const c = cloneCounts(base);
  const n = c.n;
  const M = n - 1;
  const labels = shuffle(
    Array.from({ length: n }, (_, i) => i),
    rand,
  );
  const shifts = shuffle(
    Array.from({ length: M }, (_, i) => i),
    rand,
  );
  const arrangements: number[][] = [];
  const resting: number[][] = [];
  for (let r = 0; r < rounds; r++) {
    const s = shifts[r % M]!;
    const arr = baseRound.map((v) => labels[v === M ? M : (v + s) % M]!);
    applyArrangement(c, arr);
    arrangements.push(arr);
    resting.push([]);
  }
  return { arrangements, resting, counts: c };
}

/**
 * Global hill-climb over the whole plan: swap two players within a round and
 * keep the swap if the schedule-wide objective (weighted sum of squared
 * partner counts + squared opponent counts) does not get worse. Fixes the
 * myopia of round-by-round construction. Mutates `plan` in place.
 */
function polish(plan: Plan, rand: () => number, moves: number): void {
  const c = plan.counts;
  const n = c.n;
  const rounds = plan.arrangements;
  if (rounds.length === 0) return;
  // Change in sum of squares when a symmetric pair count moves by delta (±1).
  const step = (arr: Int32Array, a: number, b: number, delta: 1 | -1): number => {
    const before = arr[a * n + b]!;
    arr[a * n + b] = before + delta;
    arr[b * n + a] = before + delta;
    return delta === 1 ? 2 * before + 1 : -(2 * before - 1);
  };
  const applyMatch = (arr: readonly number[], k: number, delta: 1 | -1): number => {
    const a = arr[4 * k]!;
    const b = arr[4 * k + 1]!;
    const x = arr[4 * k + 2]!;
    const y = arr[4 * k + 3]!;
    return (
      PARTNER_WEIGHT * (step(c.partner, a, b, delta) + step(c.partner, x, y, delta)) +
      step(c.opponent, a, x, delta) +
      step(c.opponent, a, y, delta) +
      step(c.opponent, b, x, delta) +
      step(c.opponent, b, y, delta)
    );
  };
  for (let it = 0; it < moves; it++) {
    const arr = rounds[Math.floor(rand() * rounds.length)]!;
    const len = arr.length;
    const teamSwap = rand() < 0.5;
    let i: number;
    let j: number;
    if (teamSwap) {
      // Swap two whole teams between matches: keeps partners, rebalances opponents.
      if (len < 8) continue;
      i = 2 * Math.floor(rand() * (len >> 1));
      j = 2 * Math.floor(rand() * (len >> 1));
      if (i >> 2 === j >> 2) continue;
    } else {
      i = Math.floor(rand() * len);
      j = Math.floor(rand() * len);
      if (i >> 1 === j >> 1) continue;
    }
    const mi = i >> 2;
    const mj = j >> 2;
    const swap = () => {
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      if (teamSwap) [arr[i + 1], arr[j + 1]] = [arr[j + 1]!, arr[i + 1]!];
    };
    let delta = applyMatch(arr, mi, -1) + (mi !== mj ? applyMatch(arr, mj, -1) : 0);
    swap();
    delta += applyMatch(arr, mi, 1) + (mi !== mj ? applyMatch(arr, mj, 1) : 0);
    if (delta > 0) {
      applyMatch(arr, mi, -1);
      if (mi !== mj) applyMatch(arr, mj, -1);
      swap();
      applyMatch(arr, mi, 1);
      if (mi !== mj) applyMatch(arr, mj, 1);
    }
  }
}

export function matchId(round: number, court: number): string {
  return `r${round}c${court}`;
}

/**
 * Deterministic seeded Americano scheduler.
 *
 * Guarantees: nobody appears twice in a round; matches per round =
 * min(courts, floor(n/4)); sit-outs are balanced (fewest sat-out rounds first,
 * including history, so fresh schedules differ by at most one rest per player).
 * Optimises, in order: repeated partners, then repeated opponents.
 *
 * When everyone plays every round and there is no history, an exact circle-method
 * partner construction competes with the greedy optimiser and the better schedule
 * wins; that gives perfect partner coverage for e.g. 4 players/3 rounds,
 * 8 players/2 courts/7 rounds and 12 players/3 courts/11 rounds.
 */
export function generateAmericanoSchedule(input: AmericanoScheduleInput): Round[] {
  const ids = [...input.participantIds];
  const n = ids.length;
  if (new Set(ids).size !== n) throw new Error("Participant ids must be unique");
  if (n < 4) throw new Error("Americano needs at least 4 players");
  if (!Number.isInteger(input.courts) || input.courts < 1) throw new Error("At least one court is required");
  if (!Number.isInteger(input.rounds) || input.rounds < 0) throw new Error("Rounds must be a non-negative integer");
  const history = input.history ?? [];
  const firstRound = history.reduce((max, r) => Math.max(max, r.number), 0) + 1;
  if (input.rounds === 0) return [];

  const matches = courtsInUse(n, input.courts);
  const base = countsFromHistory(ids, history);
  const rand = seededRandom(input.seed);

  const iterations = Math.max(50, 30 * 4 * matches);
  const restarts = Math.min(40, Math.max(3, Math.floor(MOVE_BUDGET / (input.rounds * iterations))));

  let best: Plan | undefined;
  let bestScore: [number, number, number] | undefined;
  const consider = (plan: Plan) => {
    const s = score(plan.counts);
    if (!bestScore || better(s, bestScore)) {
      best = plan;
      bestScore = s;
    }
  };

  const exact = history.length === 0 && n === 4 * matches;
  const cyclic = exact ? cyclicBase(n) : null;
  if (cyclic) consider(cyclicPlan(base, cyclic, input.rounds, rand));
  for (let i = 0; i < restarts; i++) {
    if (exact) consider(circlePlan(base, input.rounds, rand, iterations));
    consider(greedyPlan(base, matches, input.rounds, firstRound, rand, iterations));
  }

  const plan = best!;
  polish(plan, rand, POLISH_MOVES);
  return plan.arrangements.map((arr, r) => {
    const number = firstRound + r;
    const roundMatches: Match[] = [];
    for (let k = 0; k < matches; k++) {
      roundMatches.push({
        id: matchId(number, k + 1),
        round: number,
        court: k + 1,
        teamA: [ids[arr[4 * k]!]!, ids[arr[4 * k + 1]!]!],
        teamB: [ids[arr[4 * k + 2]!]!, ids[arr[4 * k + 3]!]!],
        status: "scheduled",
        revision: 0,
      });
    }
    return {
      number,
      status: "draft",
      matches: roundMatches,
      resting: plan.resting[r]!.map((i) => ids[i]!),
    };
  });
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Summarises a schedule (typically history + drafts) for the director before
 * publishing, with honest warnings about its limitations.
 */
export function previewSchedule(
  participantIds: readonly string[],
  rounds: readonly Round[],
  rules: Pick<TournamentRules, "courts" | "minutesPerRound">,
): SchedulePreview {
  const ids = [...participantIds];
  const n = ids.length;
  const idSet = new Set(ids);
  const restsPerPlayer: Record<string, number> = {};
  const appearancesPerPlayer: Record<string, number> = {};
  for (const id of ids) {
    restsPerPlayer[id] = 0;
    appearancesPerPlayer[id] = 0;
  }
  const partners = new Map<string, number>();
  const opponents = new Map<string, number>();
  const inc = (map: Map<string, number>, a: string, b: string) => {
    if (!idSet.has(a) || !idSet.has(b)) return;
    const key = pairKey(a, b);
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const round of rounds) {
    for (const id of round.resting) if (id in restsPerPlayer) restsPerPlayer[id]! += 1;
    for (const m of round.matches) {
      for (const id of [...m.teamA, ...m.teamB]) if (id in appearancesPerPlayer) appearancesPerPlayer[id]! += 1;
      inc(partners, m.teamA[0], m.teamA[1]);
      inc(partners, m.teamB[0], m.teamB[1]);
      for (const a of m.teamA) for (const b of m.teamB) inc(opponents, a, b);
    }
  }

  const partnerPairsPossible = (n * (n - 1)) / 2;
  const partnerPairsCovered = partners.size;
  const repeatedPartnerPairs = [...partners.values()].filter((v) => v > 1).length;
  const repeatedOpponentPairs = [...opponents.values()].filter((v) => v > 1).length;
  const matchesPerRound = courtsInUse(n, rules.courts);
  const warnings: string[] = [];

  if (n < 4) warnings.push(`At least 4 players are needed; there are ${n}`);
  if (n >= 4 && rules.courts > matchesPerRound) {
    warnings.push(
      `${n} players can only fill ${plural(matchesPerRound, "court")}; ${plural(rules.courts - matchesPerRound, "court")} will be unused`,
    );
  }
  const restingPerRound = n - 4 * matchesPerRound;
  if (n >= 4 && restingPerRound > 0) {
    warnings.push(
      `With ${n} players and ${plural(matchesPerRound, "court")}, ${restingPerRound} ${restingPerRound === 1 ? "player rests" : "players rest"} each round`,
    );
  }
  if (rounds.length > 0 && partnerPairsCovered < partnerPairsPossible) {
    const maxCoverable = rounds.reduce((sum, r) => sum + r.matches.length * 2, 0);
    const lead =
      maxCoverable < partnerPairsPossible
        ? `Not everyone can partner everyone in ${rounds.length} rounds`
        : `Not everyone partners everyone in ${rounds.length} rounds`;
    warnings.push(`${lead}: ${partnerPairsCovered} of ${partnerPairsPossible} pairs covered`);
  }
  if (repeatedPartnerPairs > 0) {
    warnings.push(`${plural(repeatedPartnerPairs, "partner pair")} play together more than once`);
  }
  const restValues = Object.values(restsPerPlayer);
  if (restValues.length) {
    const min = Math.min(...restValues);
    const max = Math.max(...restValues);
    if (max - min > 1) warnings.push(`Rests are uneven: some players rest ${min} times, others ${max}`);
  }

  return {
    rounds: rounds.length,
    courtsUsedPerRound: rounds.map((r) => r.matches.length),
    restsPerPlayer,
    appearancesPerPlayer,
    partnerPairsCovered,
    partnerPairsPossible,
    repeatedPartnerPairs,
    repeatedOpponentPairs,
    estimatedMinutes: rounds.length * rules.minutesPerRound,
    warnings,
  };
}
