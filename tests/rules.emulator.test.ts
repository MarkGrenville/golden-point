import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";

import { TEST_PROJECT_ID } from "./emulator-project";

let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":");
  env = await initializeTestEnvironment({
    projectId: TEST_PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host,
      port: Number(port),
    },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("publicEvents/e1").set({ title: "Thu" });
    await db.doc("publicScoreboards/guest-demo").set({ name: "Guest scores" });
    await db.doc("guestScoreboards/guest-demo").set({ tokenHash: "private" });
    await db.doc("guestDates/demo-date").set({ tokenHash: "private" });
    await db.doc("savedPlayers/alice").set({ names: ["Demo Player"] });
    await db.doc("events/e1").set({ title: "Thu", courts: [] });
    await db
      .doc("registrations/r1")
      .set({ uid: "alice", contactEmail: "a@example.com" });
    await db
      .doc("registrations/r2")
      .set({ uid: "bob", contactEmail: "b@example.com" });
    await db.doc("payments/r1").set({ amountCents: 15000 });
    await db.doc("merchants/w1").set({ merchantKey: "secret" });
    await db.doc("workspaces/w1").set({ members: { alice: "owner" } });
  });
});
afterAll(async () => env?.cleanup());

describe("security rules", () => {
  it("lets anyone read public projections only", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertSucceeds(anon.doc("publicEvents/e1").get());
    await assertSucceeds(anon.doc("publicScoreboards/guest-demo").get());
    await assertFails(anon.doc("guestScoreboards/guest-demo").get());
    await assertFails(anon.doc("guestDates/demo-date").get());
    await assertFails(
      anon.doc("publicScoreboards/guest-demo").update({ name: "Tampered" }),
    );
    await assertFails(anon.doc("savedPlayers/alice").get());
    await assertFails(anon.doc("events/e1").get());
    await assertFails(anon.doc("registrations/r1").get());
    await assertFails(anon.doc("payments/r1").get());
    await assertFails(anon.doc("merchants/w1").get());
  });
  it("lets a player read only their own booking", async () => {
    const alice = env.authenticatedContext("alice").firestore();
    await assertSucceeds(alice.doc("registrations/r1").get());
    await assertFails(alice.doc("registrations/r2").get());
    await assertFails(alice.doc("savedPlayers/alice").get());
    await assertFails(alice.doc("savedPlayers/bob").get());
    await assertFails(alice.doc("payments/r1").get());
    await assertFails(alice.doc("merchants/w1").get());
    await assertFails(alice.doc("guestDates/demo-date").get());
  });
  it("allows no client writes anywhere, including private date records", async () => {
    const alice = env.authenticatedContext("alice").firestore();
    await assertFails(alice.doc("events/e1").update({ courts: [] }));
    await assertFails(
      alice.doc("registrations/r1").update({ attendance: "withdrawn" }),
    );
    await assertFails(alice.doc("publicEvents/e1").set({ title: "hacked" }));
    await assertFails(alice.doc("workspaces/w1").get());
  });
});
