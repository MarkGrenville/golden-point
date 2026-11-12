import { expect, it } from "vitest";
import { savedPlayersInput } from "./saved-players";

it("accepts names only, trims them and limits the saved list", () => {
  expect(savedPlayersInput.parse([" Demo Player "])).toEqual(["Demo Player"]);
  expect(savedPlayersInput.parse([])).toEqual([]);
  for (const value of [[" "], ["a".repeat(81)], Array(101).fill("Demo"), [{ name: "Demo", email: "demo@example.com" }]]) {
    expect(savedPlayersInput.safeParse(value).success).toBe(false);
  }
});
