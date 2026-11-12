import { z } from "zod";
import { adminDb } from "./admin";
import type { Caller } from "./auth";

export const savedPlayersInput = z.array(z.string().trim().min(1).max(80)).max(100);
export async function savedPlayers(caller: Caller) {
  const data = (await adminDb().collection("savedPlayers").doc(caller.uid).get()).data();
  return { names: data?.names ?? [] };
}
export async function savePlayers(caller: Caller, input: string[]) {
  const names = [...new Set(savedPlayersInput.parse(input))];
  await adminDb().collection("savedPlayers").doc(caller.uid).set({ names });
  return { names };
}
