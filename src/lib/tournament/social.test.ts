import { describe, expect, it } from "vitest";
import { pairSocialRound } from "./social";

const names = Array.from({ length: 32 }, (_, i) => `Player ${i + 1}`);
const allPlayers = (draw: ReturnType<typeof pairSocialRound>) => [...draw.matches.flatMap(m => [...m.teamA, ...m.teamB]), ...draw.resting];

describe("social pairing", () => {
  it("assigns every player exactly once, including rests, for every supported roster and court count", () => {
    for (const mode of ["random", "balanced"] as const) {
      for (let n = 4; n <= 32; n++) {
        for (let courts = 1; courts <= Math.floor(n / 4); courts++) {
          const draw = pairSocialRound(names.slice(0, n), courts, mode, n * courts);
          expect(draw.matches.map(m => m.court)).toEqual(Array.from({ length: courts }, (_, i) => i + 1));
          expect(draw.resting).toHaveLength(n - courts * 4);
          expect(allPlayers(draw).sort()).toEqual(names.slice(0, n).sort());
          expect(new Set(allPlayers(draw)).size).toBe(n);
        }
      }
    }
  });
  it("is reproducible without mutating its input and shuffles with new seeds", () => {
    const input = Object.freeze(names.slice(0, 8));
    expect(pairSocialRound(input, 2, "random", 12)).toEqual(pairSocialRound(input, 2, "random", 12));
    expect(pairSocialRound(input, 2, "random", 12)).not.toEqual(pairSocialRound(input, 2, "random", 13));
    expect(input).toEqual(names.slice(0, 8));
  });
  it("balances nearby strength groups and keeps opposing team rank sums close", () => {
    for (let seed = 0; seed < 50; seed++) {
      const draw = pairSocialRound(names.slice(0, 12), 3, "balanced", seed);
      for (const match of draw.matches) {
        const a = match.teamA.map(name => names.indexOf(name));
        const b = match.teamB.map(name => names.indexOf(name));
        expect(Math.max(...a, ...b) - Math.min(...a, ...b)).toBe(3);
        expect(Math.abs(a[0]! + a[1]! - b[0]! - b[1]!)).toBeLessThanOrEqual(2);
      }
    }
  });
  it("allows fresh balanced partners even on one court", () => {
    const partners = new Set(Array.from({ length: 20 }, (_, seed) => pairSocialRound(names.slice(0, 4), 1, "balanced", seed).matches[0]!.teamA.join(",")));
    expect(partners.size).toBeGreaterThan(1);
  });
  it("draws rests independently of strength", () => {
    const resting = new Set(Array.from({ length: 100 }, (_, seed) => pairSocialRound(names.slice(0, 5), 1, "balanced", seed).resting[0]));
    expect(resting.size).toBe(5);
  });
  it("trims names and rejects duplicates, blank/long names, invalid counts and modes", () => {
    expect(allPlayers(pairSocialRound([" A ", "B", "C", "D"], 1, "random", 1)).sort()).toEqual(["A", "B", "C", "D"]);
    for (const input of [names.slice(0, 3), [...names, "Extra"], ["A", "a", "B", "C"], ["A", " ", "C", "D"], ["x".repeat(81), "B", "C", "D"]]) {
      expect(() => pairSocialRound(input, 1, "random", 1)).toThrow();
    }
    for (const courts of [0, -1, 1.5, 3, NaN]) expect(() => pairSocialRound(names.slice(0, 8), courts, "random", 1)).toThrow();
    // @ts-expect-error Runtime input validation
    expect(() => pairSocialRound(names.slice(0, 4), 1, "other", 1)).toThrow();
  });
});
