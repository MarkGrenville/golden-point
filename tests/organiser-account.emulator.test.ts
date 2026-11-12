import { beforeEach, expect, it } from "vitest";
import { clearFirestore } from "./helpers";
import { adminDb } from "@/server/admin";
import { createWeeklyDate, claimWeeklyDate, guestDateCaller } from "@/server/weekly-dates";
import { myWorkspaces, workspaceOverview, eventDashboard } from "@/server/organiser";
import { savedPlayers, savePlayers } from "@/server/saved-players";
import { POST as mePost } from "@/app/api/me/route";
import { POST as claimPost } from "@/app/api/dates/[id]/claim/route";

const owner = { uid: "demo-organiser", emailVerified: true };
const other = { uid: "other-demo-organiser", emailVerified: true };
const input = { title: "Demo weekly", organiserName: "Demo Organiser", venue: "Demo Courts", date: "2099-11-12", startTime: "18:00", endTime: "19:30", playerLimit: 4, priceCents: 0 };
beforeEach(clearFirestore);
it("keeps saved player lists separate between accounts and supports replacing and clearing them", async () => {
  expect(await savedPlayers(owner)).toEqual({ names: [] });
  await savePlayers(owner, ["Demo One", " Demo Two ", "Demo One"]);
  expect(await savedPlayers(owner)).toEqual({ names: ["Demo One", "Demo Two"] });
  expect(await savedPlayers(other)).toEqual({ names: [] });
  await savePlayers(other, ["Demo Three"]);
  await savePlayers(owner, []);
  expect(await savedPlayers(owner)).toEqual({ names: [] });
  expect(await savedPlayers(other)).toEqual({ names: ["Demo Three"] });
  for (const op of ["players", "players.save"]) {
    expect((await mePost(new Request("http://localhost/api/me", { method: "POST", body: JSON.stringify({ op, names: [] }) }))).status).toBe(401);
  }
});
it("saves a guest date to the account only with its valid private organiser link", async () => {
  const date = await createWeeklyDate(input, null);
  const token = date.manageUrl.split("#")[1]!;
  expect(await myWorkspaces(owner)).toEqual([]);
  await expect(claimWeeklyDate(date.id, "a".repeat(64), owner)).rejects.toThrow();
  expect((await claimPost(new Request("http://localhost/api/dates/demo/claim", { method: "POST", body: JSON.stringify({ token }) }), { params: Promise.resolve({ id: date.id }) })).status).toBe(401);
  const result = await claimWeeklyDate(date.id, token, owner);
  expect(await myWorkspaces(owner)).toMatchObject([{ id: result.workspaceId, role: "owner" }]);
  expect((await workspaceOverview(result.workspaceId, owner)).events).toMatchObject([{ id: date.id }]);
  expect((await eventDashboard(date.id, await guestDateCaller(date.id, token))).event.id).toBe(date.id);
  await expect(claimWeeklyDate(date.id, token, other)).rejects.toThrow("already saved");
  // Reopening the sign-in return must not remove co-organisers added later.
  await adminDb().doc(`workspaces/${result.workspaceId}`).update({ [`members.${other.uid}`]: "organiser" });
  await claimWeeklyDate(date.id, token, owner);
  expect((await adminDb().doc(`workspaces/${result.workspaceId}`).get()).data()?.members[other.uid]).toBe("organiser");
});
