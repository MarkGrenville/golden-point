import { seededRandom, shuffle } from "../shared/random";

export type SocialMode = "random" | "balanced";
export interface SocialDraw {
  matches: { court: number; teamA: [string, string]; teamB: [string, string] }[];
  resting: string[];
}

/** Names in strength order for balanced mode. Rests are drawn before balancing. */
export function pairSocialRound(names: readonly string[], courts: number, mode: SocialMode, seed: number): SocialDraw {
  const players = names.map(name => name.trim());
  if (players.length < 4 || players.length > 32 || players.some(name => !name || name.length > 80)) {
    throw new Error("Enter 4–32 names, each up to 80 characters.");
  }
  if (new Set(players.map(name => name.toLocaleLowerCase("en-ZA"))).size !== players.length) {
    throw new Error("Use a different name or initial for each player.");
  }
  if (!Number.isInteger(courts) || courts < 1 || courts > Math.floor(players.length / 4)) {
    throw new Error("Choose a court count that fits your players.");
  }
  if (mode !== "random" && mode !== "balanced") throw new Error("Choose random or balanced pairs.");
  const rand = seededRandom(seed);
  const order = shuffle(players, rand);
  const resting = order.slice(courts * 4);
  const playing = mode === "random" ? order.slice(0, courts * 4) : players.filter(name => !resting.includes(name));
  const matches: SocialDraw["matches"] = [];
  for (let i = 0; i < playing.length; i += 4) {
    const [a, b, c, d] = playing.slice(i, i + 4) as [string, string, string, string];
    // Either close-strength split keeps rank sums within two places. Randomise
    // between them so even a four-player balanced group can change partners.
    const swap = mode === "balanced" && rand() < 0.5;
    matches.push({ court: 0, teamA: mode === "balanced" ? [a, swap ? c : d] : [a, b], teamB: mode === "balanced" ? [b, swap ? d : c] : [c, d] });
  }
  // Mix court assignments too, without mixing distant strength groups.
  return { matches: shuffle(matches, rand).map((match, i) => ({ ...match, court: i + 1 })), resting };
}
