import type { PointsPerMatch, TournamentRules } from "./types";

export const POINTS_PER_MATCH_OPTIONS: readonly PointsPerMatch[] = [16, 24, 32];
export const DEFAULT_POINTS_PER_MATCH: PointsPerMatch = 24;

export type ScoreValidation = { ok: true } | { ok: false; error: string };

/**
 * Americano/Mexicano scores are rally points: both teams' points must be
 * non-negative whole numbers that add up exactly to the agreed points per match
 * (e.g. 15–9 or 12–12 when playing to 24).
 */
export function validateScore(
  rules: Pick<TournamentRules, "pointsPerMatch"> | undefined,
  scoreA: unknown,
  scoreB: unknown,
): ScoreValidation {
  const total = rules?.pointsPerMatch ?? DEFAULT_POINTS_PER_MATCH;
  if (!POINTS_PER_MATCH_OPTIONS.includes(total)) {
    return { ok: false, error: `Points per match must be one of ${POINTS_PER_MATCH_OPTIONS.join(", ")}` };
  }
  for (const [label, value] of [
    ["Team A", scoreA],
    ["Team B", scoreB],
  ] as const) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: `${label} score must be a number` };
    }
    if (!Number.isInteger(value)) {
      return { ok: false, error: `${label} score must be a whole number` };
    }
    if (value < 0) {
      return { ok: false, error: `${label} score cannot be negative` };
    }
  }
  const a = scoreA as number;
  const b = scoreB as number;
  if (a + b !== total) {
    return { ok: false, error: `Scores must add up to ${total} (got ${a}–${b} = ${a + b})` };
  }
  return { ok: true };
}
