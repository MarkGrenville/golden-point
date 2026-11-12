import { describe, expect, it } from "vitest";
import { weeklyDateInput } from "./weekly-dates";
const valid = () => ({ title: "Demo Thursday", organiserName: "Demo Organiser", venue: "Demo Courts", date: "2099-11-12", startTime: "18:00", endTime: "19:30", playerLimit: 16, priceCents: 15000 });
describe("weekly date validation", () => {
  it("accepts a cash date without an account or payment credentials", () => {
    expect(weeklyDateInput.parse(valid())).toMatchObject({ format: "doubles", dropOutBefore: null });
  });
  it.each([
    { date: "2026-02-30" }, { date: "2000-01-01" }, { startTime: "25:00" },
    { endTime: "17:00" }, { playerLimit: 33 }, { priceCents: 1.5 },
    { dropOutBefore: "2099-11-12T19:00:00+02:00" }, { workspaceId: "a/b" },
  ])("rejects invalid date details %j", (patch) => {
    expect(weeklyDateInput.safeParse({ ...valid(), ...patch }).success).toBe(false);
  });
});
