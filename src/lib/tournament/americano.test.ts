import { describe, expect, it } from "vitest";
import { generateAmericanoSchedule, previewSchedule } from "./americano";
import type { Round } from "./types";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

function pairCounts(rounds: readonly Round[], kind: "partner" | "opponent"): Map<string, number> {
  const map = new Map<string, number>();
  const inc = (a: string, b: string) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    map.set(k, (map.get(k) ?? 0) + 1);
  };
  for (const r of rounds) {
    for (const m of r.matches) {
      if (kind === "partner") {
        inc(m.teamA[0], m.teamA[1]);
        inc(m.teamB[0], m.teamB[1]);
      } else {
        for (const a of m.teamA) for (const b of m.teamB) inc(a, b);
      }
    }
  }
  return map;
}

function checkInvariants(players: string[], courts: number, rounds: Round[], expectedRounds: number) {
  const perRound = Math.min(courts, Math.floor(players.length / 4));
  expect(rounds).toHaveLength(expectedRounds);
  const rests = new Map(players.map((p) => [p, 0]));
  rounds.forEach((r, i) => {
    expect(r.number).toBe(i + 1);
    expect(r.status).toBe("draft");
    expect(r.matches).toHaveLength(perRound);
    const seen = [...r.matches.flatMap((m) => [...m.teamA, ...m.teamB]), ...r.resting];
    expect(new Set(seen).size).toBe(seen.length); // no player twice
    expect(seen.sort()).toEqual([...players].sort()); // everyone accounted for
    expect(r.resting).toHaveLength(players.length - 4 * perRound);
    r.matches.forEach((m, k) => {
      expect(m.court).toBe(k + 1);
      expect(m.court).toBeLessThanOrEqual(courts);
      expect(m.status).toBe("scheduled");
    });
    for (const p of r.resting) rests.set(p, rests.get(p)! + 1);
  });
  const values = [...rests.values()];
  expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
}

const configs: { n: number; courts: number; rounds: number }[] = [
  { n: 4, courts: 1, rounds: 3 },
  { n: 5, courts: 1, rounds: 5 },
  { n: 7, courts: 2, rounds: 7 },
  { n: 8, courts: 2, rounds: 7 },
  { n: 9, courts: 2, rounds: 9 },
  { n: 12, courts: 3, rounds: 11 },
  { n: 14, courts: 3, rounds: 7 },
  { n: 14, courts: 4, rounds: 10 },
  { n: 32, courts: 8, rounds: 15 },
];

describe("generateAmericanoSchedule", () => {
  for (const { n, courts, rounds } of configs) {
    it(`${n} players / ${courts} courts / ${rounds} rounds: invariants and determinism`, () => {
      const players = ids(n);
      const a = generateAmericanoSchedule({ participantIds: players, courts, rounds, seed: 42 });
      checkInvariants(players, courts, a, rounds);
      const b = generateAmericanoSchedule({ participantIds: players, courts, rounds, seed: 42 });
      expect(b).toEqual(a);
      const c = generateAmericanoSchedule({ participantIds: players, courts, rounds, seed: 43 });
      expect(c).not.toEqual(a);
    });
  }

  it("4 players over 3 rounds: every pair partners exactly once", () => {
    const rounds = generateAmericanoSchedule({ participantIds: ids(4), courts: 1, rounds: 3, seed: 1 });
    const partners = pairCounts(rounds, "partner");
    expect(partners.size).toBe(6);
    expect([...partners.values()].every((v) => v === 1)).toBe(true);
  });

  it("8 players on 2 courts over 7 rounds: every pair partners exactly once", () => {
    for (const seed of [1, 2, 3, 99]) {
      const rounds = generateAmericanoSchedule({ participantIds: ids(8), courts: 2, rounds: 7, seed });
      const partners = pairCounts(rounds, "partner");
      expect(partners.size).toBe(28);
      expect([...partners.values()].every((v) => v === 1)).toBe(true);
      // Opponents: 14 opponent slots per player over 7 others; ideal is exactly 2 each.
      const opp = pairCounts(rounds, "opponent");
      expect(opp.size).toBe(28);
      expect([...opp.values()].every((v) => v === 2)).toBe(true);
    }
  });

  it("12 players on 3 courts over 11 rounds: every pair partners once and opposes exactly twice", () => {
    for (const seed of [7, 8]) {
      const rounds = generateAmericanoSchedule({ participantIds: ids(12), courts: 3, rounds: 11, seed });
      const partners = pairCounts(rounds, "partner");
      expect(partners.size).toBe(66);
      expect([...partners.values()].every((v) => v === 1)).toBe(true);
      const opp = pairCounts(rounds, "opponent");
      expect(opp.size).toBe(66);
      expect([...opp.values()].every((v) => v === 2)).toBe(true);
    }
  });

  it("16 players on 4 courts over 15 rounds: perfect partner coverage", () => {
    const rounds = generateAmericanoSchedule({ participantIds: ids(16), courts: 4, rounds: 15, seed: 7 });
    const partners = pairCounts(rounds, "partner");
    expect(partners.size).toBe(120);
    expect([...partners.values()].every((v) => v === 1)).toBe(true);
  });

  it("14 players on 3 courts rest 2 per round", () => {
    const rounds = generateAmericanoSchedule({ participantIds: ids(14), courts: 3, rounds: 7, seed: 5 });
    for (const r of rounds) expect(r.resting).toHaveLength(2);
    // 7 rounds x 2 rests = 14: everyone rests exactly once
    const rested = rounds.flatMap((r) => r.resting);
    expect(new Set(rested).size).toBe(14);
  });

  it("uneven sizes avoid repeat partners while coverage allows", () => {
    for (const { n, courts, rounds } of [
      { n: 5, courts: 1, rounds: 5 },
      { n: 9, courts: 2, rounds: 9 },
      { n: 14, courts: 3, rounds: 7 },
    ]) {
      const schedule = generateAmericanoSchedule({ participantIds: ids(n), courts, rounds, seed: 11 });
      const partners = [...pairCounts(schedule, "partner").values()];
      expect(Math.max(...partners)).toBe(1);
    }
  });

  it("is fast for 32 players, 8 courts, 15 rounds", () => {
    const start = performance.now();
    generateAmericanoSchedule({ participantIds: ids(32), courts: 8, rounds: 15, seed: 3 });
    expect(performance.now() - start).toBeLessThan(300);
  });

  it("is fast for 30 players (with rests), 7 courts, 15 rounds", () => {
    const start = performance.now();
    const rounds = generateAmericanoSchedule({ participantIds: ids(30), courts: 7, rounds: 15, seed: 3 });
    expect(performance.now() - start).toBeLessThan(300);
    checkInvariants(ids(30), 7, rounds, 15);
  });

  it("regenerates remaining rounds from history, continuing numbering and counts", () => {
    const full = generateAmericanoSchedule({ participantIds: ids(8), courts: 2, rounds: 7, seed: 9 });
    const history = full.slice(0, 3).map((r) => ({ ...r, status: "completed" as const }));
    const players = [...ids(8), "p9"];
    const rest = generateAmericanoSchedule({ participantIds: players, courts: 2, rounds: 4, seed: 10, history });
    expect(rest.map((r) => r.number)).toEqual([4, 5, 6, 7]);
    // p9 sat out three rounds already, so never rests in the remaining four
    for (const r of rest) expect(r.resting).not.toContain("p9");
    // the one rest per round rotates among the original eight
    const rested = rest.flatMap((r) => r.resting);
    expect(new Set(rested).size).toBe(4);
    // history partners are not repeated
    const historyPairs = pairCounts(history, "partner");
    const newPairs = pairCounts(rest, "partner");
    for (const k of newPairs.keys()) expect(historyPairs.has(k)).toBe(false);
  });
});

describe("previewSchedule", () => {
  it("warns about rests and partner coverage for 14 players on 3 courts", () => {
    const players = ids(14);
    const rounds = generateAmericanoSchedule({ participantIds: players, courts: 3, rounds: 7, seed: 5 });
    const p = previewSchedule(players, rounds, { courts: 3, minutesPerRound: 15 });
    expect(p.warnings).toContain("With 14 players and 3 courts, 2 players rest each round");
    expect(p.partnerPairsPossible).toBe(91);
    expect(p.partnerPairsCovered).toBe(42);
    expect(p.warnings).toContain("Not everyone can partner everyone in 7 rounds: 42 of 91 pairs covered");
    expect(p.repeatedPartnerPairs).toBe(0);
    expect(p.estimatedMinutes).toBe(105);
    expect(p.courtsUsedPerRound).toEqual([3, 3, 3, 3, 3, 3, 3]);
    expect(Object.values(p.restsPerPlayer).every((v) => v === 1)).toBe(true);
    expect(Object.values(p.appearancesPerPlayer).every((v) => v === 6)).toBe(true);
  });

  it("has no coverage warning for a perfect 8-player schedule, and flags unusable courts", () => {
    const players = ids(8);
    const rounds = generateAmericanoSchedule({ participantIds: players, courts: 4, rounds: 7, seed: 5 });
    const p = previewSchedule(players, rounds, { courts: 4, minutesPerRound: 12 });
    expect(p.partnerPairsCovered).toBe(28);
    expect(p.warnings).toEqual(["8 players can only fill 2 courts; 2 courts will be unused"]);
    expect(p.estimatedMinutes).toBe(84);
  });

  it("reports repeated partner pairs", () => {
    const players = ids(4);
    const rounds = generateAmericanoSchedule({ participantIds: players, courts: 1, rounds: 6, seed: 5 });
    const p = previewSchedule(players, rounds, { courts: 1, minutesPerRound: 10 });
    expect(p.repeatedPartnerPairs).toBe(6);
    expect(p.warnings).toContain("6 partner pairs play together more than once");
  });
});
