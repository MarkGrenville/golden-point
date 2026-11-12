import { hashSeed } from "../shared/random";
import { courtsInUse, generateAmericanoSchedule } from "./americano";
import { generateMexicanoFirstRound, generateMexicanoNextRound } from "./mexicano";
import { DEFAULT_POINTS_PER_MATCH, validateScore } from "./scoring";
import { computeStandings } from "./standings";
import type {
  AuditEntry,
  Match,
  Participant,
  ParticipantFinancialStatus,
  Round,
  Tournament,
  TournamentRules,
} from "./types";

export const MIN_PARTICIPANTS = 4;
export const MAX_PARTICIPANTS = 32;
export const MAX_COURTS = 8;
export const DEFAULT_MINUTES_PER_ROUND = 15;

export interface TournamentContext {
  actor: string;
  /** ISO timestamp supplied by the caller (pure logic never reads the clock). */
  now: string;
}

export class TournamentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TournamentError";
  }
}

export class RevisionConflictError extends TournamentError {
  readonly matchId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;
  constructor(matchId: string, expectedRevision: number, actualRevision: number) {
    super(
      `Match ${matchId} was changed by someone else (revision ${actualRevision}, expected ${expectedRevision}). Reload and try again.`,
    );
    this.name = "RevisionConflictError";
    this.matchId = matchId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export interface NewParticipantInput {
  name: string;
  seed?: number;
  financialStatus?: ParticipantFinancialStatus;
  registrationId?: string;
  checkedIn?: boolean;
}

export type TournamentRulesInput = Pick<TournamentRules, "format" | "rounds" | "courts"> & Partial<TournamentRules>;

export interface CreateTournamentInput {
  id: string;
  name: string;
  rules: TournamentRulesInput;
  participants: readonly NewParticipantInput[];
  seed: number;
  now: string;
  eventId?: string;
  /** Recorded on the "created" audit entry; defaults to "system". */
  actor?: string;
}

// ---------------------------------------------------------------- helpers

function fail(message: string): never {
  throw new TournamentError(message);
}

function withAudit(t: Tournament, ctx: TournamentContext, action: string, detail?: string): Tournament {
  const entry: AuditEntry = detail === undefined ? { at: ctx.now, actor: ctx.actor, action } : { at: ctx.now, actor: ctx.actor, action, detail };
  return { ...t, audit: [...t.audit, entry], revision: t.revision + 1 };
}

export function activeParticipants(t: Tournament): Participant[] {
  return t.participants.filter((p) => p.active);
}

/** The published (in-progress or not yet started) round, if any. */
export function liveRound(t: Tournament): Round | undefined {
  return t.rounds.find((r) => r.status === "published");
}

/** Latest round that is published or completed. */
export function currentRound(t: Tournament): Round | undefined {
  const visible = t.rounds.filter((r) => r.status !== "draft");
  return visible[visible.length - 1];
}

export function roundHasResults(r: Round): boolean {
  return r.matches.some((m) => m.status !== "scheduled");
}

function isRoundDone(r: Round): boolean {
  return r.matches.every((m) => m.status !== "scheduled");
}

function completedRoundCount(t: Tournament): number {
  return t.rounds.filter((r) => r.status === "completed").length;
}

export function findMatch(t: Tournament, matchId: string): { round: Round; match: Match } | undefined {
  for (const round of t.rounds) {
    const match = round.matches.find((m) => m.id === matchId);
    if (match) return { round, match };
  }
  return undefined;
}

/**
 * Regenerated matches reuse ids like r3c1; bump their revision past any
 * previous match with the same id so stale clients can't write onto them.
 */
function carryRevisions(oldRounds: readonly Round[], newRounds: readonly Round[]): Round[] {
  const old = new Map<string, number>();
  for (const r of oldRounds) for (const m of r.matches) old.set(m.id, m.revision);
  return newRounds.map((r) => ({
    ...r,
    matches: r.matches.map((m) => {
      const prev = old.get(m.id);
      return prev === undefined ? m : { ...m, revision: Math.max(m.revision, prev + 1) };
    }),
  }));
}

function publish(r: Round): Round {
  return { ...r, status: isRoundDone(r) && r.matches.length > 0 ? "completed" : "published" };
}

function names(t: Tournament, ids: readonly string[]): string {
  const byId = new Map(t.participants.map((p) => [p.id, p.name]));
  return ids.map((id) => byId.get(id) ?? id).join(" & ");
}

function validateRules(rules: TournamentRules): void {
  if (rules.format !== "americano" && rules.format !== "mexicano") fail("Format must be americano or mexicano");
  if (![16, 24, 32].includes(rules.pointsPerMatch)) fail("Points per match must be 16, 24 or 32");
  if (!Number.isInteger(rules.courts) || rules.courts < 1 || rules.courts > MAX_COURTS) {
    fail(`Courts must be a whole number from 1 to ${MAX_COURTS}`);
  }
  if (!Number.isInteger(rules.rounds) || rules.rounds < 1) fail("Rounds must be a whole number of at least 1");
  if (rules.rounds > 100) fail("At most 100 rounds are supported");
  if (!Number.isFinite(rules.minutesPerRound) || rules.minutesPerRound <= 0) {
    fail("Minutes per round must be positive");
  }
}

// ---------------------------------------------------------------- setup

export function createTournament(input: CreateTournamentInput): Tournament {
  const rules: TournamentRules = {
    pointsPerMatch: DEFAULT_POINTS_PER_MATCH,
    minutesPerRound: DEFAULT_MINUTES_PER_ROUND,
    lateEntrantsEligibleToWin: false,
    ...input.rules,
  };
  validateRules(rules);
  if (!input.name.trim()) fail("Tournament name is required");
  const n = input.participants.length;
  if (n < MIN_PARTICIPANTS || n > MAX_PARTICIPANTS) {
    fail(`Tournaments need ${MIN_PARTICIPANTS}–${MAX_PARTICIPANTS} participants (got ${n})`);
  }
  const participants: Participant[] = input.participants.map((p, i) => {
    const name = p.name.trim();
    if (!name) fail(`Participant ${i + 1} needs a name`);
    if (p.seed !== undefined && !Number.isFinite(p.seed)) fail(`Seed for ${name} must be a number`);
    const out: Participant = {
      id: `p${i + 1}`,
      name,
      active: true,
      joinedRound: 1,
      checkedIn: p.checkedIn ?? false,
      financialStatus: p.financialStatus ?? "not_applicable",
    };
    if (p.seed !== undefined) out.seed = p.seed;
    if (p.registrationId !== undefined) out.registrationId = p.registrationId;
    return out;
  });
  const t: Tournament = {
    id: input.id,
    name: input.name.trim(),
    rules,
    seed: input.seed >>> 0,
    status: "setup",
    participants,
    rounds: [],
    rosterVersion: 0,
    revision: 0,
    audit: [],
    createdAt: input.now,
  };
  if (input.eventId !== undefined) t.eventId = input.eventId;
  const warnings = setupWarnings(t);
  return withAudit(
    t,
    { actor: input.actor ?? "system", now: input.now },
    "created",
    `${rules.format}, ${n} players, ${rules.courts} courts, ${rules.rounds} rounds${warnings.length ? `; ${warnings.join("; ")}` : ""}`,
  );
}

/** Non-blocking issues to show the director (courts that can't be filled, duplicate names, rests). */
export function setupWarnings(t: Tournament): string[] {
  const active = activeParticipants(t);
  const n = active.length;
  const warnings: string[] = [];
  const usable = courtsInUse(n, t.rules.courts);
  if (n >= MIN_PARTICIPANTS && t.rules.courts > usable) {
    warnings.push(`${n} players can only fill ${usable} of ${t.rules.courts} courts`);
  }
  const resting = n - 4 * usable;
  if (n >= MIN_PARTICIPANTS && resting > 0) {
    warnings.push(`With ${n} players and ${usable} court${usable === 1 ? "" : "s"}, ${resting} ${resting === 1 ? "player rests" : "players rest"} each round`);
  }
  const seen = new Set<string>();
  for (const p of active) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) warnings.push(`More than one player is called ${p.name}`);
    seen.add(key);
  }
  return warnings;
}

function scheduleSeed(t: Tournament): number {
  return hashSeed(`${t.seed}:roster:${t.rosterVersion}`);
}

export function startTournament(t: Tournament, ctx: TournamentContext): Tournament {
  if (t.status !== "setup") fail("Tournament has already started");
  const active = activeParticipants(t);
  if (active.length < MIN_PARTICIPANTS) fail(`At least ${MIN_PARTICIPANTS} active players are needed`);
  if (active.length > MAX_PARTICIPANTS) fail(`At most ${MAX_PARTICIPANTS} players are supported`);
  let rounds: Round[];
  if (t.rules.format === "americano") {
    rounds = generateAmericanoSchedule({
      participantIds: active.map((p) => p.id),
      courts: t.rules.courts,
      rounds: t.rules.rounds,
      seed: t.seed,
    });
  } else {
    rounds = [generateMexicanoFirstRound({ participants: active, courts: t.rules.courts, seed: t.seed })];
  }
  rounds[0] = publish(rounds[0]!);
  return withAudit(
    { ...t, status: "running", rosterVersion: 1, rounds },
    ctx,
    "started",
    `${active.length} players; round 1 published`,
  );
}

// ---------------------------------------------------------------- results

function updateMatch(
  t: Tournament,
  matchId: string,
  expectedRevision: number,
  change: (m: Match) => Match,
): { t: Tournament; before: Match; round: Round } {
  if (t.status !== "running") fail("Results can only be changed while the tournament is running");
  const found = findMatch(t, matchId);
  if (!found) fail(`Match ${matchId} not found`);
  const { round, match } = found;
  if (round.status === "draft") fail(`Round ${round.number} has not been published yet`);
  if (match.revision !== expectedRevision) throw new RevisionConflictError(matchId, expectedRevision, match.revision);
  const updated = { ...change(match), revision: match.revision + 1 };
  const matches = round.matches.map((m) => (m.id === matchId ? updated : m));
  const newRound: Round = { ...round, matches };
  if (newRound.status === "published" && isRoundDone(newRound)) newRound.status = "completed";
  return {
    t: { ...t, rounds: t.rounds.map((r) => (r === round ? newRound : r)) },
    before: match,
    round: newRound,
  };
}

export interface ResultInput {
  scoreA: number;
  scoreB: number;
  reason?: string;
}

export function recordResult(
  t: Tournament,
  matchId: string,
  result: ResultInput,
  expectedRevision: number,
  ctx: TournamentContext,
): Tournament {
  const check = validateScore(t.rules, result.scoreA, result.scoreB);
  if (!check.ok) fail(check.error);
  const reason = result.reason?.trim();
  const { t: next, before, round } = updateMatch(t, matchId, expectedRevision, (m) => {
    const out: Match = {
      ...m,
      status: "completed",
      result: reason ? { scoreA: result.scoreA, scoreB: result.scoreB, reason } : { scoreA: result.scoreA, scoreB: result.scoreB },
    };
    delete out.voidReason;
    return out;
  });
  const corrected = before.status !== "scheduled";
  const prev = before.result ? ` (was ${before.result.scoreA}–${before.result.scoreB})` : before.status === "void" ? " (was void)" : "";
  let out = withAudit(
    next,
    ctx,
    corrected ? "corrected" : "result",
    `Round ${round.number} court ${before.court}: ${names(t, before.teamA)} ${result.scoreA}–${result.scoreB} ${names(t, before.teamB)}${corrected ? prev : ""}${reason ? `; ${reason}` : ""}`,
  );
  const wasDone = t.rounds.find((r) => r.number === round.number)?.status === "completed";
  if (round.status === "completed" && !wasDone) {
    out = { ...out, audit: [...out.audit, { at: ctx.now, actor: ctx.actor, action: "round_completed", detail: `Round ${round.number}` }] };
  }
  return out;
}

export function voidMatch(
  t: Tournament,
  matchId: string,
  reason: string,
  expectedRevision: number,
  ctx: TournamentContext,
): Tournament {
  const why = reason.trim();
  if (!why) fail("A reason is required to void a match");
  const { t: next, before, round } = updateMatch(t, matchId, expectedRevision, (m) => {
    const out: Match = { ...m, status: "void", voidReason: why };
    delete out.result;
    return out;
  });
  let out = withAudit(next, ctx, "voided", `Round ${round.number} court ${before.court}: ${why}`);
  const wasDone = t.rounds.find((r) => r.number === round.number)?.status === "completed";
  if (round.status === "completed" && !wasDone) {
    out = { ...out, audit: [...out.audit, { at: ctx.now, actor: ctx.actor, action: "round_completed", detail: `Round ${round.number}` }] };
  }
  return out;
}

// ---------------------------------------------------------------- rounds

export function publishNextRound(t: Tournament, ctx: TournamentContext): Tournament {
  if (t.status !== "running") fail("Tournament is not running");
  const live = liveRound(t);
  if (live) fail(`Round ${live.number} is still in progress`);
  if (t.rules.format === "americano") {
    const draft = t.rounds.find((r) => r.status === "draft");
    if (!draft) fail("All planned rounds have been played");
    return withAudit(
      { ...t, rounds: t.rounds.map((r) => (r === draft ? publish(r) : r)) },
      ctx,
      "round_published",
      `Round ${draft.number}`,
    );
  }
  if (completedRoundCount(t) >= t.rules.rounds) fail("All planned rounds have been played");
  let round: Round;
  try {
    round = generateMexicanoNextRound(t);
  } catch (e) {
    fail((e as Error).message);
  }
  return withAudit({ ...t, rounds: [...t.rounds, publish(round)] }, ctx, "round_published", `Round ${round.number}`);
}

export interface CorrectionImpact {
  matchId: string;
  matchRound: number;
  /** Published/completed rounds after the corrected match's round. */
  laterRounds: number[];
  /** True if any later round already has results. */
  laterRoundsStarted: boolean;
  /** Mexicano only: the latest round has no results and can be redrawn from corrected standings. */
  canRegenerate: boolean;
  /** Round that `regenerateUnstartedRound` would replace. */
  regenerableRound?: number;
  message: string;
}

export function correctionImpact(t: Tournament, matchId: string): CorrectionImpact {
  const found = findMatch(t, matchId);
  if (!found) fail(`Match ${matchId} not found`);
  const matchRound = found.round.number;
  const later = t.rounds.filter((r) => r.status !== "draft" && r.number > matchRound);
  const laterRoundsStarted = later.some(roundHasResults);
  const latest = later[later.length - 1];
  const canRegenerate =
    t.rules.format === "mexicano" && !!latest && latest.status === "published" && !roundHasResults(latest);
  let message: string;
  if (later.length === 0) {
    message = "No later rounds have been drawn; the corrected result simply updates the standings.";
  } else if (t.rules.format === "americano") {
    message = "The Americano schedule is fixed; the correction updates the standings only.";
  } else if (canRegenerate) {
    message = `Round ${latest!.number} has not started and can be redrawn from the corrected standings.`;
  } else {
    message = "Later rounds have already started, so their assignments are kept; corrected standings feed the next draw.";
  }
  const out: CorrectionImpact = { matchId, matchRound, laterRounds: later.map((r) => r.number), laterRoundsStarted, canRegenerate, message };
  if (canRegenerate) out.regenerableRound = latest!.number;
  return out;
}

function redrawMexicanoRound(t: Tournament, round: Round): Round {
  const before = t.rounds.filter((r) => r.number < round.number);
  if (round.number === 1) {
    return generateMexicanoFirstRound({ participants: activeParticipants(t), courts: t.rules.courts, seed: scheduleSeed(t) });
  }
  return generateMexicanoNextRound({ ...t, rounds: before });
}

/** Mexicano: replace the latest published round (with no results yet) using current standings. */
export function regenerateUnstartedRound(t: Tournament, ctx: TournamentContext): Tournament {
  if (t.status !== "running") fail("Tournament is not running");
  if (t.rules.format !== "mexicano") fail("Only Mexicano rounds are drawn from standings");
  const live = liveRound(t);
  if (!live) fail("There is no published round to redraw");
  if (roundHasResults(live)) fail(`Round ${live.number} already has results`);
  const redrawn = carryRevisions(t.rounds, [publish(redrawMexicanoRound(t, live))])[0]!;
  return withAudit(
    { ...t, rounds: t.rounds.map((r) => (r === live ? redrawn : r)) },
    ctx,
    "round_regenerated",
    `Round ${live.number}`,
  );
}

// ---------------------------------------------------------------- roster changes

/**
 * Roster changes happen between rounds: when no published round is in
 * progress, or when the published round has no results yet (it is then
 * redrawn with the new roster).
 */
function assertBetweenRounds(t: Tournament): Round | undefined {
  const live = liveRound(t);
  if (live && roundHasResults(live)) {
    fail(`Round ${live.number} is in progress; roster changes are allowed between rounds`);
  }
  return live;
}

export function canChangeRoster(t: Tournament): boolean {
  if (t.status === "setup") return true;
  if (t.status !== "running") return false;
  const live = liveRound(t);
  return !live || !roundHasResults(live);
}

function reschedule(t: Tournament, unstarted: Round | undefined): Tournament {
  const active = activeParticipants(t).map((p) => p.id);
  if (t.rules.format === "americano") {
    const history = t.rounds.filter((r) => r.status === "completed");
    const remaining = Math.max(0, t.rules.rounds - history.length);
    let fresh = generateAmericanoSchedule({
      participantIds: active,
      courts: t.rules.courts,
      rounds: remaining,
      seed: scheduleSeed(t),
      history,
    });
    if (unstarted && fresh[0]) fresh = [publish(fresh[0]), ...fresh.slice(1)];
    return { ...t, rounds: [...history, ...carryRevisions(t.rounds, fresh)] };
  }
  if (!unstarted) return t;
  const redrawn = carryRevisions(t.rounds, [publish(redrawMexicanoRound(t, unstarted))])[0]!;
  return { ...t, rounds: t.rounds.map((r) => (r === unstarted ? redrawn : r)) };
}

export function addLateParticipant(t: Tournament, input: NewParticipantInput, ctx: TournamentContext): Tournament {
  if (t.status === "finished") fail("Tournament has finished");
  const name = input.name.trim();
  if (!name) fail("Name is required");
  if (activeParticipants(t).length >= MAX_PARTICIPANTS) fail(`At most ${MAX_PARTICIPANTS} players are supported`);
  const unstarted = t.status === "running" ? assertBetweenRounds(t) : undefined;
  const lastPlayed = t.rounds.filter((r) => r.status === "completed").reduce((m, r) => Math.max(m, r.number), 0);
  const joinedRound = t.status === "setup" ? 1 : unstarted ? unstarted.number : lastPlayed + 1;
  const p: Participant = {
    id: `p${t.participants.length + 1}`,
    name,
    active: true,
    joinedRound,
    checkedIn: input.checkedIn ?? true,
    financialStatus: input.financialStatus ?? "not_applicable",
  };
  if (input.seed !== undefined) p.seed = input.seed;
  if (input.registrationId !== undefined) p.registrationId = input.registrationId;
  let next: Tournament = { ...t, participants: [...t.participants, p] };
  if (t.status === "running") {
    next = reschedule({ ...next, rosterVersion: t.rosterVersion + 1 }, unstarted);
  }
  return withAudit(next, ctx, "participant_added", `${name} (${p.id}) joins from round ${joinedRound}`);
}

export function withdrawParticipant(t: Tournament, participantId: string, ctx: TournamentContext): Tournament {
  if (t.status === "finished") fail("Tournament has finished");
  const p = t.participants.find((x) => x.id === participantId);
  if (!p) fail(`Participant ${participantId} not found`);
  if (!p.active) fail(`${p.name} has already withdrawn`);
  const unstarted = t.status === "running" ? assertBetweenRounds(t) : undefined;
  if (t.status === "running" && activeParticipants(t).length - 1 < MIN_PARTICIPANTS) {
    fail(`At least ${MIN_PARTICIPANTS} active players are needed`);
  }
  const leftAfterRound = t.rounds.filter((r) => r.status === "completed").reduce((m, r) => Math.max(m, r.number), 0);
  let next: Tournament = {
    ...t,
    participants: t.participants.map((x) => (x.id === participantId ? { ...x, active: false, leftAfterRound } : x)),
  };
  if (t.status === "running") {
    next = reschedule({ ...next, rosterVersion: t.rosterVersion + 1 }, unstarted);
  }
  return withAudit(next, ctx, "participant_withdrawn", `${p.name} (${p.id}) after round ${leftAfterRound}`);
}

export function finishTournament(t: Tournament, ctx: TournamentContext): Tournament {
  if (t.status !== "running") fail("Tournament is not running");
  const drafts = t.rounds.filter((r) => r.status === "draft").length;
  const unplayed = t.rounds
    .filter((r) => r.status === "published")
    .reduce((n, r) => n + r.matches.filter((m) => m.status === "scheduled").length, 0);
  const detail = [drafts ? `${drafts} unplayed draft round(s) dropped` : "", unplayed ? `${unplayed} match(es) without result` : ""]
    .filter(Boolean)
    .join("; ");
  return withAudit(
    { ...t, status: "finished", rounds: t.rounds.filter((r) => r.status !== "draft") },
    ctx,
    "finished",
    detail || undefined,
  );
}

// ---------------------------------------------------------------- export

function csvCell(value: string | number | boolean): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows: (string | number | boolean)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/** Fixtures and results: round,court,team A,team B,score A,score B,status. */
export function toCsv(t: Tournament): string {
  const rows: (string | number)[][] = [["round", "court", "team A", "team B", "score A", "score B", "status"]];
  for (const r of t.rounds) {
    for (const m of r.matches) {
      rows.push([
        r.number,
        m.court,
        names(t, m.teamA),
        names(t, m.teamB),
        m.result?.scoreA ?? "",
        m.result?.scoreB ?? "",
        r.status === "draft" ? "draft" : m.status,
      ]);
    }
  }
  return csv(rows);
}

export function standingsCsv(t: Tournament): string {
  const rows: (string | number | boolean)[][] = [
    ["rank", "name", "points", "played", "wins", "draws", "losses", "rests", "points per match", "win rate", "eligible", "active"],
  ];
  for (const s of computeStandings(t)) {
    rows.push([
      s.tied ? `=${s.rank}` : s.rank,
      s.name,
      s.points,
      s.played,
      s.wins,
      s.draws,
      s.losses,
      s.rests,
      Math.round(s.pointsPerMatch * 100) / 100,
      Math.round(s.winRate * 1000) / 1000,
      s.eligible ? "yes" : "no",
      s.active ? "yes" : "no",
    ]);
  }
  return csv(rows);
}

// ---------------------------------------------------------------- setup edits

export function setCheckIn(t: Tournament, participantId: string, checkedIn: boolean, ctx: TournamentContext): Tournament {
  const p = t.participants.find((x) => x.id === participantId);
  if (!p) fail(`Participant ${participantId} not found`);
  return withAudit(
    { ...t, participants: t.participants.map((x) => (x.id === participantId ? { ...x, checkedIn } : x)) },
    ctx,
    checkedIn ? "checked_in" : "check_in_cleared",
    p.name,
  );
}

/** Rules can only change before the roster is frozen at start. */
export function updateSetup(t: Tournament, patch: { name?: string; rules?: Partial<TournamentRules> }, ctx: TournamentContext): Tournament {
  if (t.status !== "setup") fail("Rules are frozen once the tournament starts");
  const rules = { ...t.rules, ...patch.rules };
  validateRules(rules);
  const name = patch.name?.trim() || t.name;
  return withAudit({ ...t, name, rules }, ctx, "setup_updated", JSON.stringify(patch.rules ?? {}));
}
