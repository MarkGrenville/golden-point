import { describe, expect, it } from "vitest";
import { validateScore } from "./scoring";
import { computeStandings, winners } from "./standings";
import { createTournament } from "./tournament";
import type { Match, Round, Tournament } from "./types";

describe("validateScore", () => {
  const rules24 = { pointsPerMatch: 24 as const };
  it("accepts scores summing to the points per match", () => {
    expect(validateScore(rules24, 15, 9)).toEqual({ ok: true });
    expect(validateScore(rules24, 12, 12)).toEqual({ ok: true });
    expect(validateScore(rules24, 24, 0)).toEqual({ ok: true });
    expect(validateScore({ pointsPerMatch: 16 }, 10, 6)).toEqual({ ok: true });
    expect(validateScore({ pointsPerMatch: 32 }, 17, 15)).toEqual({ ok: true });
    expect(validateScore(undefined, 13, 11)).toEqual({ ok: true }); // default 24
  });
  it("rejects wrong totals, negatives and fractions", () => {
    expect(validateScore(rules24, 13, 12).ok).toBe(false);
    expect(validateScore(rules24, -1, 25).ok).toBe(false);
    expect(validateScore(rules24, 1.5, 22.5).ok).toBe(false);
    expect(validateScore(rules24, Number.NaN, 24).ok).toBe(false);
    expect(validateScore(rules24, "12", 12).ok).toBe(false);
    const r = validateScore(rules24, 13, 12);
    expect(r.ok === false && r.error).toMatch(/add up to 24/);
  });
});

function baseTournament(n: number, lateEligible = false): Tournament {
  return {
    ...createTournament({
      id: "t",
      name: "Test",
      rules: { format: "americano", rounds: 3, courts: 2, lateEntrantsEligibleToWin: lateEligible },
      participants: Array.from({ length: n }, (_, i) => ({ name: `Player ${String.fromCharCode(65 + i)}` })),
      seed: 1,
      now: "2026-01-01T00:00:00Z",
    }),
    status: "running",
  };
}

let mid = 0;
function m(teamA: [string, string], teamB: [string, string], scoreA?: number, scoreB?: number, status?: Match["status"]): Match {
  const done = scoreA !== undefined && scoreB !== undefined;
  return {
    id: `m${++mid}`,
    round: 0,
    court: 1,
    teamA,
    teamB,
    status: status ?? (done ? "completed" : "scheduled"),
    ...(done ? { result: { scoreA, scoreB } } : {}),
    revision: 1,
  };
}

function round(number: number, matches: Match[], resting: string[] = [], status: Round["status"] = "completed"): Round {
  return { number, status, matches: matches.map((x) => ({ ...x, round: number })), resting };
}

describe("computeStandings", () => {
  it("gives both teammates the team points and ranks by total when appearances are equal", () => {
    const t = { ...baseTournament(4), rounds: [round(1, [m(["p1", "p2"], ["p3", "p4"], 15, 9)]), round(2, [m(["p1", "p3"], ["p2", "p4"], 14, 10)])] };
    const s = computeStandings(t);
    const byId = Object.fromEntries(s.map((r) => [r.participantId, r]));
    expect(byId.p1!.points).toBe(29);
    expect(byId.p2!.points).toBe(25);
    expect(byId.p3!.points).toBe(23);
    expect(byId.p4!.points).toBe(19);
    expect(s.map((r) => r.participantId)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(s.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(byId.p1!.wins).toBe(2);
    expect(byId.p4!.losses).toBe(2);
    expect(byId.p1!.played).toBe(2);
  });

  it("ignores void and scheduled matches and counts rests without points", () => {
    const t = {
      ...baseTournament(5),
      rounds: [
        round(1, [m(["p1", "p2"], ["p3", "p4"], 12, 12)], ["p5"]),
        round(2, [{ ...m(["p1", "p5"], ["p3", "p4"]), status: "void" as const, voidReason: "rain" }], ["p2"]),
        round(3, [m(["p2", "p5"], ["p3", "p1"])], ["p4"], "published"),
        round(4, [m(["p2", "p5"], ["p3", "p1"])], ["p1"], "draft"),
      ],
    };
    const s = computeStandings(t);
    const byId = Object.fromEntries(s.map((r) => [r.participantId, r]));
    expect(byId.p1!.points).toBe(12);
    expect(byId.p1!.played).toBe(1);
    expect(byId.p1!.draws).toBe(1);
    expect(byId.p1!.rests).toBe(0); // draft round rest not counted
    expect(byId.p5!.played).toBe(0);
    expect(byId.p5!.points).toBe(0);
    expect(byId.p5!.rests).toBe(1);
    expect(byId.p4!.rests).toBe(1); // published round rest counts
  });

  it("ranks by points per match when appearances differ", () => {
    // p5 played once scoring 20; others played twice.
    const t = {
      ...baseTournament(5),
      rounds: [
        round(1, [m(["p1", "p2"], ["p3", "p4"], 13, 11)], ["p5"]),
        round(2, [m(["p5", "p1"], ["p2", "p3"], 20, 4)], ["p4"]),
        round(3, [m(["p2", "p4"], ["p3", "p5"], 14, 10)], ["p1"]),
      ],
    };
    const s = computeStandings(t);
    const byId = Object.fromEntries(s.map((r) => [r.participantId, r]));
    // totals: p1 33/2=16.5, p2 31/3, p3 25/3, p4 25/2=12.5, p5 30/2=15
    expect(byId.p1!.pointsPerMatch).toBe(16.5);
    expect(s.map((r) => r.participantId)).toEqual(["p1", "p5", "p4", "p2", "p3"]);
  });

  it("uses win rate as second comparator, then shares ranks", () => {
    // p1,p2 win 13-11 then lose 11-13: 24 pts, 1 win. p3,p4 mirror: 24 pts, 1 win -> all tied.
    const t = {
      ...baseTournament(4),
      rounds: [round(1, [m(["p1", "p2"], ["p3", "p4"], 13, 11)]), round(2, [m(["p1", "p2"], ["p3", "p4"], 11, 13)])],
    };
    const s = computeStandings(t);
    expect(s.every((r) => r.rank === 1 && r.tied)).toBe(true);
    expect(s.map((r) => r.name)).toEqual(["Player A", "Player B", "Player C", "Player D"]);
    expect(winners(s)).toHaveLength(4);

    // Same points but different win rates: 12-12 draw twice vs win+loss? p1,p2: 24 (2 draws). p3,p4 24 (2 draws). Add a second court.
    const t2 = {
      ...baseTournament(8),
      rounds: [
        round(1, [m(["p1", "p2"], ["p3", "p4"], 16, 8), m(["p5", "p6"], ["p7", "p8"], 12, 12)]),
        round(2, [m(["p1", "p2"], ["p3", "p4"], 8, 16), m(["p5", "p6"], ["p7", "p8"], 12, 12)]),
      ],
    };
    const s2 = computeStandings(t2);
    // everyone has 24 points; p1-p4 win rate 0.5 (1 win 1 loss), p5-p8 win rate 0.5 (2 draws) -> all tied
    expect(new Set(s2.map((r) => r.rank))).toEqual(new Set([1]));

    const t3 = {
      ...baseTournament(8),
      rounds: [
        round(1, [m(["p1", "p2"], ["p3", "p4"], 13, 11), m(["p5", "p6"], ["p7", "p8"], 20, 4)]),
        round(2, [m(["p1", "p2"], ["p5", "p6"], 13, 11), m(["p3", "p4"], ["p7", "p8"], 12, 12)]),
      ],
    };
    const s3 = computeStandings(t3);
    // p5,p6: 31 pts; p1,p2: 26 pts 2 wins; p3,p4: 23; p7,p8: 16
    expect(s3.map((r) => [r.participantId, r.rank, r.tied])).toEqual([
      ["p5", 1, true],
      ["p6", 1, true],
      ["p1", 3, true],
      ["p2", 3, true],
      ["p3", 5, true],
      ["p4", 5, true],
      ["p7", 7, true],
      ["p8", 7, true],
    ]);
  });

  it("separates equal points by win rate", () => {
    const t = {
      ...baseTournament(8),
      rounds: [
        round(1, [m(["p1", "p2"], ["p3", "p4"], 13, 11), m(["p5", "p6"], ["p7", "p8"], 12, 12)]),
        round(2, [m(["p1", "p3"], ["p5", "p7"], 11, 13), m(["p2", "p4"], ["p6", "p8"], 12, 12)]),
      ],
    };
    const s = computeStandings(t);
    const byId = Object.fromEntries(s.map((r) => [r.participantId, r]));
    // p1: 13+11 = 24, 1 win 1 loss (0.5). p5: 12+13 = 25. p2: 13+12 = 25 (1 win, 1 draw -> 0.75). p6: 12+12 = 24 (0.5)
    expect(byId.p2!.points).toBe(25);
    expect(byId.p5!.points).toBe(25);
    expect(byId.p2!.winRate).toBe(0.75);
    expect(byId.p5!.winRate).toBe(0.75);
    expect(byId.p2!.rank).toBe(byId.p5!.rank);
    expect(byId.p1!.points).toBe(24);
    expect(byId.p6!.points).toBe(24);
    expect(byId.p8!.points).toBe(24);
    // p1 1W1L (0.5), p6 2D (0.5), p8 2D (0.5): tied
    expect(byId.p1!.rank).toBe(byId.p6!.rank);
    // p3: 11+11 = 22, 0 wins; p4: 11+12=23
    expect(byId.p4!.rank).toBeLessThan(byId.p3!.rank);
  });

  it("keeps departed players' results and excludes late entrants from winning by default", () => {
    const base = baseTournament(5);
    const t: Tournament = {
      ...base,
      participants: [
        ...base.participants.map((p) => (p.id === "p4" ? { ...p, active: false, leftAfterRound: 1 } : p)),
        { id: "p6", name: "Late", active: true, joinedRound: 2, checkedIn: true, financialStatus: "cash_received" },
      ],
      rounds: [
        round(1, [m(["p1", "p2"], ["p3", "p4"], 13, 11)], ["p5"]),
        round(2, [m(["p6", "p5"], ["p1", "p2"], 20, 4)], ["p3"]),
      ],
    };
    const s = computeStandings(t);
    const byId = Object.fromEntries(s.map((r) => [r.participantId, r]));
    expect(byId.p4!.active).toBe(false);
    expect(byId.p4!.points).toBe(11);
    expect(byId.p4!.eligible).toBe(true);
    expect(byId.p6!.rank).toBe(1);
    expect(byId.p6!.eligible).toBe(false);
    const w = winners(s);
    expect(w.map((r) => r.participantId)).not.toContain("p6");
    expect(w.every((r) => r.eligible)).toBe(true);
    expect(w.map((r) => r.participantId)).toEqual(["p5"]); // 20/1 ppm; p6 also 20 but ineligible

    const eligibleLate = computeStandings({ ...t, rules: { ...t.rules, lateEntrantsEligibleToWin: true } });
    expect(winners(eligibleLate).map((r) => r.participantId).sort()).toEqual(["p5", "p6"]);

    // A departed player with no results is omitted entirely.
    const gone = computeStandings({
      ...t,
      participants: t.participants.map((p) => (p.id === "p3" ? { ...p, active: false } : p)),
      rounds: [round(1, [m(["p1", "p2"], ["p5", "p4"], 13, 11)], ["p3"])],
    });
    expect(gone.find((r) => r.participantId === "p3")).toBeUndefined();
  });
});
