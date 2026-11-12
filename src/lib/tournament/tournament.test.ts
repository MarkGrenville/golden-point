import { describe, expect, it } from "vitest";
import { seededRandom } from "../shared/random";
import { generateMexicanoFirstRound, generateMexicanoNextRound } from "./mexicano";
import { computeStandings, winners } from "./standings";
import {
  addLateParticipant,
  correctionImpact,
  createTournament,
  finishTournament,
  liveRound,
  publishNextRound,
  recordResult,
  regenerateUnstartedRound,
  RevisionConflictError,
  setupWarnings,
  standingsCsv,
  startTournament,
  toCsv,
  TournamentError,
  voidMatch,
  withdrawParticipant,
} from "./tournament";
import type { Participant, Round, Tournament, TournamentFormat } from "./types";

const ctx = { actor: "director", now: "2026-10-27T10:00:00Z" };

function fourteen(format: TournamentFormat, rounds = 7) {
  const paid = Array.from({ length: 12 }, (_, i) => ({
    name: `Paid ${i + 1}`,
    financialStatus: "paid_online" as const,
    registrationId: `reg${i + 1}`,
  }));
  return createTournament({
    id: `t-${format}`,
    name: "Friday social",
    rules: { format, rounds, courts: 3 },
    participants: [
      ...paid,
      { name: "Walk-in One", financialStatus: "cash_received" },
      { name: "Walk-in Two", financialStatus: "paid_externally" },
    ],
    seed: 1234,
    now: ctx.now,
  });
}

function playRound(t: Tournament, rand: () => number): Tournament {
  const live = liveRound(t);
  if (!live) throw new Error("no live round");
  for (const m of live.matches) {
    const a = Math.floor(rand() * 25);
    t = recordResult(t, m.id, { scoreA: a, scoreB: 24 - a }, m.revision, ctx);
  }
  return t;
}

function assertRoundsValid(t: Tournament) {
  const active = new Set(t.participants.filter((p) => p.active).map((p) => p.id));
  for (const r of t.rounds) {
    if (r.status === "completed") continue; // history may contain departed players
    const seen = [...r.matches.flatMap((m) => [...m.teamA, ...m.teamB]), ...r.resting];
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of seen) expect(active.has(id)).toBe(true);
    expect(seen.length).toBe(active.size);
  }
}

function runToEnd(t: Tournament, seed: number): Tournament {
  const rand = seededRandom(seed);
  t = startTournament(t, ctx);
  for (;;) {
    assertRoundsValid(t);
    t = playRound(t, rand);
    try {
      t = publishNextRound(t, ctx);
    } catch (e) {
      expect(e).toBeInstanceOf(TournamentError);
      expect((e as Error).message).toMatch(/All planned rounds/);
      break;
    }
  }
  return finishTournament(t, ctx);
}

describe("createTournament", () => {
  it("assigns deterministic ids and defaults", () => {
    const t = fourteen("americano");
    expect(t.participants.map((p) => p.id)).toEqual(Array.from({ length: 14 }, (_, i) => `p${i + 1}`));
    expect(t.rules.pointsPerMatch).toBe(24);
    expect(t.rules.lateEntrantsEligibleToWin).toBe(false);
    expect(t.status).toBe("setup");
    expect(t.audit[0]).toMatchObject({ action: "created", at: ctx.now });
    expect(t.participants[0]).toMatchObject({ financialStatus: "paid_online", registrationId: "reg1", joinedRound: 1, active: true });
    expect(setupWarnings(t)).toContain("With 14 players and 3 courts, 2 players rest each round");
  });

  it("validates participant count, courts and rounds", () => {
    const base = { id: "x", name: "X", seed: 1, now: ctx.now };
    const players = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));
    expect(() => createTournament({ ...base, rules: { format: "americano", rounds: 3, courts: 1 }, participants: players(3) })).toThrow(TournamentError);
    expect(() => createTournament({ ...base, rules: { format: "americano", rounds: 3, courts: 1 }, participants: players(33) })).toThrow(/4–32/);
    expect(() => createTournament({ ...base, rules: { format: "americano", rounds: 3, courts: 9 }, participants: players(8) })).toThrow(/Courts/);
    expect(() => createTournament({ ...base, rules: { format: "americano", rounds: 0, courts: 1 }, participants: players(8) })).toThrow(/Rounds/);
    const capped = createTournament({ ...base, rules: { format: "americano", rounds: 3, courts: 4 }, participants: players(9) });
    expect(setupWarnings(capped)).toContain("9 players can only fill 2 of 4 courts");
    const started = startTournament(capped, ctx);
    expect(started.rounds.every((r) => r.matches.length === 2)).toBe(true);
  });
});

describe("12 paid players plus two manual additions on three courts", () => {
  for (const format of ["americano", "mexicano"] as const) {
    it(`${format}: runs end to end`, () => {
      const t = runToEnd(fourteen(format), 77);
      expect(t.status).toBe("finished");
      expect(t.rounds).toHaveLength(7);
      expect(t.rounds.every((r) => r.status === "completed" && r.matches.length === 3 && r.resting.length === 2)).toBe(true);
      const s = computeStandings(t);
      expect(s).toHaveLength(14);
      expect(s.reduce((n, r) => n + r.points, 0)).toBe(7 * 3 * 2 * 24);
      expect(s.reduce((n, r) => n + r.played, 0)).toBe(7 * 3 * 4);
      expect(s.reduce((n, r) => n + r.rests, 0)).toBe(7 * 2);
      for (const r of s) expect(r.played + r.rests).toBe(7);
      // ranks are non-decreasing and start at 1
      expect(s[0]!.rank).toBe(1);
      for (let i = 1; i < s.length; i++) expect(s[i]!.rank).toBeGreaterThanOrEqual(s[i - 1]!.rank);
      expect(winners(s).length).toBeGreaterThanOrEqual(1);
      expect(winners(s).every((w) => w.rank === 1)).toBe(true);
      if (format === "americano") {
        // fair rests: everyone rests once in 7 rounds
        expect(s.every((r) => r.rests === 1)).toBe(true);
      } else {
        const rests = s.map((r) => r.rests);
        expect(Math.max(...rests) - Math.min(...rests)).toBeLessThanOrEqual(1);
      }
      const csv = toCsv(t);
      expect(csv.split("\n")[0]).toBe("round,court,team A,team B,score A,score B,status");
      expect(csv.trim().split("\n")).toHaveLength(1 + 21);
      expect(standingsCsv(t).trim().split("\n")).toHaveLength(15);
      expect(t.audit.at(-1)!.action).toBe("finished");
    });
  }

  it("is deterministic for the same seed", () => {
    expect(runToEnd(fourteen("americano"), 5)).toEqual(runToEnd(fourteen("americano"), 5));
    expect(runToEnd(fourteen("mexicano"), 5)).toEqual(runToEnd(fourteen("mexicano"), 5));
  });
});

describe("startTournament", () => {
  it("Americano drafts every round and publishes round 1", () => {
    const t = startTournament(fourteen("americano"), ctx);
    expect(t.status).toBe("running");
    expect(t.rosterVersion).toBe(1);
    expect(t.rounds.map((r) => r.status)).toEqual(["published", "draft", "draft", "draft", "draft", "draft", "draft"]);
  });
  it("Mexicano publishes only round 1", () => {
    const t = startTournament(fourteen("mexicano"), ctx);
    expect(t.rounds.map((r) => r.status)).toEqual(["published"]);
    expect(() => startTournament(t, ctx)).toThrow(TournamentError);
  });
  it("cannot publish the next round while the current one is in progress", () => {
    const t = startTournament(fourteen("americano"), ctx);
    expect(() => publishNextRound(t, ctx)).toThrow(/still in progress/);
  });
});

describe("recordResult", () => {
  it("validates scores and rejects draft rounds", () => {
    const t = startTournament(fourteen("americano"), ctx);
    const m = t.rounds[0]!.matches[0]!;
    expect(() => recordResult(t, m.id, { scoreA: 13, scoreB: 12 }, 0, ctx)).toThrow(/add up to 24/);
    const draft = t.rounds[1]!.matches[0]!;
    expect(() => recordResult(t, draft.id, { scoreA: 12, scoreB: 12 }, 0, ctx)).toThrow(/not been published/);
  });

  it("throws RevisionConflictError on a stale revision", () => {
    const t = startTournament(fourteen("americano"), ctx);
    const m = t.rounds[0]!.matches[0]!;
    const t1 = recordResult(t, m.id, { scoreA: 15, scoreB: 9 }, 0, ctx);
    expect(t1.rounds[0]!.matches[0]!.revision).toBe(1);
    expect(t1.revision).toBe(t.revision + 1);
    let err: unknown;
    try {
      recordResult(t1, m.id, { scoreA: 12, scoreB: 12 }, 0, { ...ctx, actor: "other" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RevisionConflictError);
    expect(err).toMatchObject({ matchId: m.id, expectedRevision: 0, actualRevision: 1 });
    // original object untouched (immutability)
    expect(t.rounds[0]!.matches[0]!.status).toBe("scheduled");
  });

  it("completes the round when every match is in", () => {
    let t = startTournament(fourteen("americano"), ctx);
    t = playRound(t, seededRandom(1));
    expect(t.rounds[0]!.status).toBe("completed");
    expect(t.audit.map((a) => a.action)).toContain("round_completed");
    t = publishNextRound(t, ctx);
    expect(t.rounds[1]!.status).toBe("published");
  });
});

describe("corrections", () => {
  it("corrects an earlier round without changing later assignments", () => {
    let t = startTournament(fourteen("americano"), ctx);
    const rand = seededRandom(3);
    t = playRound(t, rand);
    t = publishNextRound(t, ctx);
    t = playRound(t, rand);
    const target = t.rounds[0]!.matches[1]!;
    const before = computeStandings(t);
    const round2 = t.rounds[1];
    const drafts = t.rounds.slice(2);
    const newA = target.result!.scoreA === 24 ? 0 : 24;
    const t2 = recordResult(t, target.id, { scoreA: newA, scoreB: 24 - newA, reason: "scorecard misread" }, target.revision, ctx);
    expect(t2.audit.at(-1)).toMatchObject({ action: "corrected", actor: "director" });
    expect(t2.audit.at(-1)!.detail).toMatch(/was /);
    expect(t2.rounds[0]!.status).toBe("completed");
    expect(t2.rounds[1]).toBe(round2);
    expect(t2.rounds.slice(2)).toEqual(drafts);
    const after = computeStandings(t2);
    const p = target.teamA[0];
    const delta = newA - target.result!.scoreA;
    expect(after.find((r) => r.participantId === p)!.points).toBe(before.find((r) => r.participantId === p)!.points + delta);
    const impact = correctionImpact(t2, target.id);
    expect(impact).toMatchObject({ matchRound: 1, laterRounds: [2], laterRoundsStarted: true, canRegenerate: false });
  });

  it("Mexicano can regenerate an unstarted next round after a correction", () => {
    let t = startTournament(fourteen("mexicano"), ctx);
    t = playRound(t, seededRandom(4));
    t = publishNextRound(t, ctx);
    const target = t.rounds[0]!.matches[0]!;
    // flip the result so the ranking changes
    const t2 = recordResult(t, target.id, { scoreA: 24 - target.result!.scoreA, scoreB: target.result!.scoreA }, target.revision, ctx);
    const impact = correctionImpact(t2, target.id);
    expect(impact).toMatchObject({ matchRound: 1, laterRounds: [2], laterRoundsStarted: false, canRegenerate: true, regenerableRound: 2 });
    const t3 = regenerateUnstartedRound(t2, ctx);
    expect(t3.rounds).toHaveLength(2);
    expect(t3.rounds[1]!.status).toBe("published");
    expect(t3.rounds[1]!.matches.map((m) => [...m.teamA, ...m.teamB])).toEqual(generateMexicanoNextRound({ ...t2, rounds: [t2.rounds[0]!] }).matches.map((m) => [...m.teamA, ...m.teamB]));
    // regenerated matches get a bumped revision so stale writes fail
    expect(t3.rounds[1]!.matches.every((m) => m.revision >= 1)).toBe(true);
    expect(t3.audit.at(-1)!.action).toBe("round_regenerated");
    // once results exist, it can't be regenerated
    const m = t3.rounds[1]!.matches[0]!;
    const t4 = recordResult(t3, m.id, { scoreA: 12, scoreB: 12 }, m.revision, ctx);
    expect(() => regenerateUnstartedRound(t4, ctx)).toThrow(/already has results/);
    expect(correctionImpact(t4, target.id).canRegenerate).toBe(false);
  });
});

describe("voidMatch", () => {
  it("voids a match: no points, round still completes", () => {
    let t = startTournament(fourteen("americano"), ctx);
    const [m1, m2, m3] = t.rounds[0]!.matches as [Round["matches"][0], Round["matches"][0], Round["matches"][0]];
    t = recordResult(t, m1.id, { scoreA: 20, scoreB: 4 }, 0, ctx);
    t = voidMatch(t, m2.id, "injury", 0, ctx);
    expect(() => voidMatch(t, m3.id, "  ", 0, ctx)).toThrow(/reason/);
    t = recordResult(t, m3.id, { scoreA: 10, scoreB: 14 }, 0, ctx);
    expect(t.rounds[0]!.status).toBe("completed");
    const s = computeStandings(t);
    for (const id of [...m2.teamA, ...m2.teamB]) {
      const row = s.find((r) => r.participantId === id)!;
      expect(row.played).toBe(0);
      expect(row.points).toBe(0);
    }
    expect(t.rounds[0]!.matches[1]).toMatchObject({ status: "void", voidReason: "injury", revision: 1 });
    // a voided match can later be given a result
    t = recordResult(t, m2.id, { scoreA: 12, scoreB: 12, reason: "replayed" }, 1, ctx);
    expect(t.audit.at(-1)!.action).toBe("corrected");
  });
});

describe("Mexicano", () => {
  it("round 1 orders by seed when seeds are given", () => {
    const participants: Participant[] = Array.from({ length: 9 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `P${i + 1}`,
      active: true,
      joinedRound: 1,
      checkedIn: true,
      financialStatus: "not_applicable",
      ...(i < 8 ? { seed: 8 - i } : {}),
    }));
    const r = generateMexicanoFirstRound({ participants, courts: 2, seed: 1 });
    // seeds: p8=1, p7=2, ... p1=8; p9 unseeded rests
    expect(r.matches[0]).toMatchObject({ court: 1, teamA: ["p8", "p5"], teamB: ["p7", "p6"] });
    expect(r.matches[1]).toMatchObject({ court: 2, teamA: ["p4", "p1"], teamB: ["p3", "p2"] });
    expect(r.resting).toEqual(["p9"]);
    const random = generateMexicanoFirstRound({ participants: participants.map(({ seed: _seed, ...p }) => p), courts: 2, seed: 1 });
    expect(random).toEqual(generateMexicanoFirstRound({ participants: participants.map(({ seed: _seed, ...p }) => p), courts: 2, seed: 1 }));
  });

  it("pairs 1st+4th vs 2nd+3rd from the standings, top group on court 1", () => {
    let t = startTournament(
      createTournament({
        id: "m",
        name: "Mex",
        rules: { format: "mexicano", rounds: 4, courts: 2 },
        participants: Array.from({ length: 8 }, (_, i) => ({ name: `P${i + 1}` })),
        seed: 9,
        now: ctx.now,
      }),
      ctx,
    );
    const [c1, c2] = t.rounds[0]!.matches as [Round["matches"][0], Round["matches"][0]];
    t = recordResult(t, c1.id, { scoreA: 18, scoreB: 6 }, 0, ctx);
    t = recordResult(t, c2.id, { scoreA: 10, scoreB: 14 }, 0, ctx);
    expect(() => generateMexicanoNextRound({ ...t, rounds: [{ ...t.rounds[0]!, matches: [{ ...c1 }] }] })).toThrow(/without a result/);
    const order = computeStandings(t).map((r) => r.participantId);
    t = publishNextRound(t, ctx);
    const r2 = t.rounds[1]!;
    expect(r2.status).toBe("published");
    expect(r2.matches[0]).toMatchObject({ court: 1, teamA: [order[0], order[3]], teamB: [order[1], order[2]] });
    expect(r2.matches[1]).toMatchObject({ court: 2, teamA: [order[4], order[7]], teamB: [order[5], order[6]] });
  });

  it("rests the players with fewest rests, then stops at the planned rounds", () => {
    let t = startTournament(
      createTournament({
        id: "m",
        name: "Mex",
        rules: { format: "mexicano", rounds: 5, courts: 1 },
        participants: Array.from({ length: 5 }, (_, i) => ({ name: `P${i + 1}` })),
        seed: 2,
        now: ctx.now,
      }),
      ctx,
    );
    const rand = seededRandom(8);
    for (let i = 0; i < 4; i++) {
      t = playRound(t, rand);
      t = publishNextRound(t, ctx);
    }
    t = playRound(t, rand);
    expect(() => publishNextRound(t, ctx)).toThrow(/All planned rounds/);
    const resters = t.rounds.flatMap((r) => r.resting);
    expect(new Set(resters).size).toBe(5);
  });
});

describe("roster changes between rounds", () => {
  it("Americano late arrival and withdrawal regenerate remaining rounds, preserving history", () => {
    let t = startTournament(
      createTournament({
        id: "a",
        name: "Am",
        rules: { format: "americano", rounds: 7, courts: 2 },
        participants: Array.from({ length: 8 }, (_, i) => ({ name: `P${i + 1}` })),
        seed: 21,
        now: ctx.now,
      }),
      ctx,
    );
    const rand = seededRandom(5);
    t = playRound(t, rand);
    t = publishNextRound(t, ctx);
    // mid-round: not allowed
    const m = t.rounds[1]!.matches[0]!;
    const midRound = recordResult(t, m.id, { scoreA: 12, scoreB: 12 }, m.revision, ctx);
    expect(() => addLateParticipant(midRound, { name: "Late" }, ctx)).toThrow(/between rounds/);
    expect(() => withdrawParticipant(midRound, "p1", ctx)).toThrow(/between rounds/);
    t = playRound(t, rand);
    const history = t.rounds.slice(0, 2);

    t = addLateParticipant(t, { name: "Late Larry", financialStatus: "cash_received" }, ctx);
    expect(t.rosterVersion).toBe(2);
    expect(t.rounds.slice(0, 2)).toEqual(history);
    expect(t.rounds).toHaveLength(7);
    expect(t.rounds.slice(2).every((r) => r.status === "draft")).toBe(true);
    const late = t.participants.find((p) => p.name === "Late Larry")!;
    expect(late).toMatchObject({ id: "p9", joinedRound: 3, active: true, financialStatus: "cash_received" });
    for (const r of t.rounds.slice(2)) {
      expect(r.matches).toHaveLength(2);
      expect(r.resting).toHaveLength(1);
      expect(r.resting).not.toContain("p9");
    }
    assertRoundsValid(t);

    t = publishNextRound(t, ctx);
    t = playRound(t, rand);
    const history3 = t.rounds.slice(0, 3);
    t = withdrawParticipant(t, "p2", ctx);
    expect(t.rounds.slice(0, 3)).toEqual(history3);
    expect(t.participants.find((p) => p.id === "p2")).toMatchObject({ active: false, leftAfterRound: 3 });
    for (const r of t.rounds.slice(3)) {
      expect(r.matches.flatMap((x) => [...x.teamA, ...x.teamB])).not.toContain("p2");
      expect(r.resting).toHaveLength(0);
    }
    assertRoundsValid(t);
    expect(t.audit.map((a) => a.action)).toEqual(expect.arrayContaining(["participant_added", "participant_withdrawn"]));

    // finish the event; the departed player keeps results
    for (;;) {
      try {
        t = publishNextRound(t, ctx);
      } catch {
        break;
      }
      t = playRound(t, rand);
    }
    t = finishTournament(t, ctx);
    const s = computeStandings(t);
    expect(s.find((r) => r.participantId === "p2")).toMatchObject({ active: false, played: 3 });
    expect(s.find((r) => r.participantId === "p9")!.eligible).toBe(false);
    expect(winners(s).every((w) => w.participantId !== "p9")).toBe(true);
  });

  it("redraws a published round that has no results yet", () => {
    const t = startTournament(fourteen("americano"), ctx);
    const r1 = t.rounds[0]!;
    const t2 = withdrawParticipant(t, r1.matches[0]!.teamA[0], ctx);
    expect(t2.rounds[0]!.status).toBe("published");
    expect(t2.rounds[0]!.matches.flatMap((m) => [...m.teamA, ...m.teamB])).not.toContain(r1.matches[0]!.teamA[0]);
    expect(t2.rounds[0]!.matches.every((m) => m.revision >= 1)).toBe(true);
    // stale write against the old draw fails
    expect(() => recordResult(t2, r1.matches[0]!.id, { scoreA: 12, scoreB: 12 }, 0, ctx)).toThrow(RevisionConflictError);
    assertRoundsValid(t2);

    const mex = startTournament(fourteen("mexicano"), ctx);
    const mex2 = addLateParticipant(mex, { name: "Late" }, ctx);
    expect(mex2.rounds).toHaveLength(1);
    expect(mex2.participants.at(-1)).toMatchObject({ id: "p15", joinedRound: 1 });
    expect(mex2.rounds[0]!.matches).toHaveLength(3);
    expect(mex2.rounds[0]!.resting).toHaveLength(3);
    assertRoundsValid(mex2);
  });

  it("Mexicano late entrant joins the next draw", () => {
    let t = startTournament(fourteen("mexicano"), ctx);
    t = playRound(t, seededRandom(6));
    t = addLateParticipant(t, { name: "Late" }, ctx);
    t = addLateParticipant(t, { name: "Later" }, ctx);
    t = publishNextRound(t, ctx);
    const r2 = t.rounds[1]!;
    expect(r2.matches).toHaveLength(3);
    expect(r2.resting).toHaveLength(4);
    // newcomers sat out round 1, so they play now
    const playing = r2.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
    expect(playing).toEqual(expect.arrayContaining(["p15", "p16"]));
    assertRoundsValid(t);
  });

  it("refuses to drop below four players", () => {
    let t = startTournament(
      createTournament({
        id: "a",
        name: "Am",
        rules: { format: "americano", rounds: 3, courts: 1 },
        participants: Array.from({ length: 4 }, (_, i) => ({ name: `P${i + 1}` })),
        seed: 1,
        now: ctx.now,
      }),
      ctx,
    );
    t = playRound(t, seededRandom(1));
    expect(() => withdrawParticipant(t, "p1", ctx)).toThrow(/At least 4/);
  });
});
