/**
 * Pure tournament model shared by local standalone sessions and server-validated
 * cloud sessions. Everything here is plain JSON so it can live in localStorage or
 * Firestore unchanged.
 */

export type TournamentFormat = "americano" | "mexicano";
export type PointsPerMatch = 16 | 24 | 32;

export interface TournamentRules {
  format: TournamentFormat;
  pointsPerMatch: PointsPerMatch;
  /** Number of rounds planned. Americano schedules all of them up front. */
  rounds: number;
  courts: number;
  /** Minutes per round including changeover, for duration estimates. */
  minutesPerRound: number;
  /** Late entrants are provisional and excluded from the final winner by default. */
  lateEntrantsEligibleToWin: boolean;
}

export type ParticipantFinancialStatus =
  | "paid_online"
  | "paid_externally"
  | "cash_received"
  | "fee_waived"
  | "unpaid_exception"
  | "not_applicable";

export interface Participant {
  id: string;
  name: string;
  /** Optional director-entered seed; lower is stronger. Used by Mexicano round 1. */
  seed?: number;
  active: boolean;
  /** Round number (1-based) the player joined at; 1 for the starting roster. */
  joinedRound: number;
  /** Round number after which the player left, if they departed. */
  leftAfterRound?: number;
  checkedIn: boolean;
  financialStatus: ParticipantFinancialStatus;
  /** Registration this participant was imported from, if any. */
  registrationId?: string;
}

export type MatchStatus = "scheduled" | "completed" | "void";

export interface MatchResult {
  scoreA: number;
  scoreB: number;
  /** Set when a director enters a result for an abandoned match. */
  reason?: string;
}

export interface Match {
  id: string;
  round: number;
  court: number;
  teamA: [string, string];
  teamB: [string, string];
  status: MatchStatus;
  result?: MatchResult;
  /** Incremented on every change for optimistic concurrency. */
  revision: number;
  voidReason?: string;
}

export type RoundStatus = "draft" | "published" | "completed";

export interface Round {
  number: number;
  status: RoundStatus;
  matches: Match[];
  resting: string[];
}

export type TournamentStatus = "setup" | "running" | "finished";

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  detail?: string;
}

export interface Tournament {
  id: string;
  name: string;
  rules: TournamentRules;
  seed: number;
  status: TournamentStatus;
  participants: Participant[];
  rounds: Round[];
  /** Frozen roster version; incremented whenever the active roster changes after start. */
  rosterVersion: number;
  /** Whole-document revision for concurrent-edit checks. */
  revision: number;
  audit: AuditEntry[];
  createdAt: string;
  /** Optional link to the paid event this tournament was started from. */
  eventId?: string;
}

export interface StandingRow {
  participantId: string;
  name: string;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  rests: number;
  pointsPerMatch: number;
  winRate: number;
  /** Shared ranks for unresolved ties: e.g. two players tied 2nd both show 2. */
  rank: number;
  tied: boolean;
  eligible: boolean;
  active: boolean;
}

export interface SchedulePreview {
  rounds: number;
  courtsUsedPerRound: number[];
  restsPerPlayer: Record<string, number>;
  appearancesPerPlayer: Record<string, number>;
  /** Distinct partner pairs achieved vs total possible pairs. */
  partnerPairsCovered: number;
  partnerPairsPossible: number;
  repeatedPartnerPairs: number;
  repeatedOpponentPairs: number;
  estimatedMinutes: number;
  /** Honest limitations to show before publishing the draw. */
  warnings: string[];
}
