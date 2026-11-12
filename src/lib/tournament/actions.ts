import {
  addLateParticipant,
  finishTournament,
  publishNextRound,
  recordResult,
  regenerateUnstartedRound,
  setCheckIn,
  startTournament,
  TournamentError,
  updateSetup,
  voidMatch,
  withdrawParticipant,
  type TournamentContext,
} from "./tournament";
import type { ParticipantFinancialStatus, Tournament, TournamentRules } from "./types";

/** Every mutation a director or scorer can make, shared by local sessions and the server. */
export type TournamentAction =
  | { type: "start"; expectedRevision: number }
  | { type: "publish_next"; expectedRevision: number }
  | { type: "regenerate_round"; expectedRevision: number }
  | { type: "finish"; expectedRevision: number }
  | { type: "result"; matchId: string; expectedMatchRevision: number; scoreA: number; scoreB: number; reason?: string }
  | { type: "void"; matchId: string; expectedMatchRevision: number; reason: string }
  | { type: "add_player"; expectedRevision: number; name: string; financialStatus: ParticipantFinancialStatus }
  | { type: "withdraw_player"; expectedRevision: number; participantId: string }
  | { type: "check_in"; participantId: string; checkedIn: boolean }
  | { type: "update_setup"; expectedRevision: number; name?: string; rules?: Partial<TournamentRules> };

export const DIRECTOR_ACTIONS: ReadonlySet<TournamentAction["type"]> = new Set([
  "start", "publish_next", "regenerate_round", "finish", "add_player", "withdraw_player", "update_setup", "check_in",
]);

export function applyTournamentAction(t: Tournament, action: TournamentAction, ctx: TournamentContext): Tournament {
  if ("expectedRevision" in action && action.expectedRevision !== t.revision) {
    throw new TournamentError("The tournament changed on another device. Reload to see the latest state.");
  }
  switch (action.type) {
    case "start": return startTournament(t, ctx);
    case "publish_next": return publishNextRound(t, ctx);
    case "regenerate_round": return regenerateUnstartedRound(t, ctx);
    case "finish": return finishTournament(t, ctx);
    case "result": return recordResult(t, action.matchId, { scoreA: action.scoreA, scoreB: action.scoreB, reason: action.reason }, action.expectedMatchRevision, ctx);
    case "void": return voidMatch(t, action.matchId, action.reason, action.expectedMatchRevision, ctx);
    case "add_player": return addLateParticipant(t, { name: action.name, financialStatus: action.financialStatus }, ctx);
    case "withdraw_player": return withdrawParticipant(t, action.participantId, ctx);
    case "check_in": return setCheckIn(t, action.participantId, action.checkedIn, ctx);
    case "update_setup": return updateSetup(t, { name: action.name, rules: action.rules }, ctx);
  }
}
