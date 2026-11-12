import { beforeEach, describe, expect, it } from "vitest";
import { PUT } from "@/app/api/scoreboards/[id]/route";
import { adminDb } from "@/server/admin";
import {
  createTournament,
  startTournament,
  recordResult,
  toScoreboard,
} from "@/lib/tournament";
import { clearFirestore } from "./helpers";

const id = "guest-00000000-0000-4000-8000-000000000001";
const token = "ab".repeat(32);
const context = { actor: "local", now: "2026-11-12T16:00:00.000Z" };
function tournament() {
  return startTournament(
    createTournament({
      id: "local-demo",
      name: "Guest Americano",
      rules: { format: "americano", courts: 2, rounds: 7 },
      participants: Array.from({ length: 8 }, (_, i) => ({
        name: `Demo Player ${i + 1}`,
        checkedIn: true,
      })),
      seed: 42,
      now: context.now,
      actor: "local",
    }),
    context,
  );
}
async function publish(board: unknown, secret = token, boardId = id) {
  return PUT(
    new Request(`http://localhost/api/scoreboards/${boardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: secret, board }),
    }),
    { params: Promise.resolve({ id: boardId }) },
  );
}
const read = async () =>
  (await adminDb().doc(`publicScoreboards/${id}`).get()).data()!;
beforeEach(clearFirestore);

describe("guest live scoreboards", () => {
  it("publishes eight players without auth and sends scored matches to the same live link", async () => {
    const t = tournament();
    expect((await publish(toScoreboard(t, context.now))).status).toBe(200);
    expect((await read()).standings).toHaveLength(8);
    const match = t.rounds[0]!.matches[0]!;
    const scored = recordResult(
      t,
      match.id,
      { scoreA: 15, scoreB: 9 },
      match.revision,
      context,
    );
    expect((await publish(toScoreboard(scored, context.now))).status).toBe(200);
    expect((await read()).rounds[0].matches[0]).toMatchObject({
      status: "completed",
      scoreA: 15,
      scoreB: 9,
    });
    expect(
      (await read()).standings.some((p: { points: number }) => p.points === 15),
    ).toBe(true);
  });
  it("rejects a spectator trying to overwrite a scoreboard and never exposes the write token", async () => {
    const board = toScoreboard(tournament(), context.now);
    await publish(board);
    const wrong = await publish(
      { ...board, revision: board.revision + 1, name: "Overwritten" },
      "cd".repeat(32),
    );
    expect(wrong.status).toBe(403);
    expect((await read()).name).toBe("Guest Americano");
    expect(JSON.stringify(await read())).not.toMatch(/token|tokenHash|ab{32}/);
    expect(
      (await adminDb().doc(`guestScoreboards/${id}`).get()).data()?.tokenHash,
    ).not.toBe(token);
  });
  it("keeps a stable link across retries and ignores older snapshots", async () => {
    const t = tournament();
    const board = toScoreboard(t, context.now);
    const match = t.rounds[0]!.matches[0]!;
    const scored = recordResult(
      t,
      match.id,
      { scoreA: 16, scoreB: 8 },
      match.revision,
      context,
    );
    await publish(board);
    await publish(toScoreboard(scored, context.now));
    await publish(board);
    await publish(board);
    expect((await read()).revision).toBe(scored.revision);
    expect((await read()).rounds[0].matches[0].scoreA).toBe(16);
    expect((await adminDb().collection("publicScoreboards").get()).size).toBe(
      1,
    );
  });
  it("strips private fields and validates shape before writing", async () => {
    const board = toScoreboard(tournament(), context.now);
    await publish({
      ...board,
      contactEmail: "private@example.com",
      token,
      participants: [{ financialStatus: "paid_online" }],
      standings: board.standings.map((p) => ({
        ...p,
        registrationId: "private-reg",
      })),
    });
    expect(JSON.stringify(await read())).not.toMatch(
      /private@example|private-reg|paid_online|participants/,
    );
    expect(
      (
        await publish({
          ...board,
          standings: Array(33).fill(board.standings[0]),
        })
      ).status,
    ).toBe(400);
    expect((await publish(board, token, "cloud-tournament")).status).toBe(400);
  });
  it("rejects malformed and oversized requests before publishing", async () => {
    for (const body of ["not json", " ".repeat(200001)]) {
      const response = await PUT(
        new Request(`http://localhost/api/scoreboards/${id}`, {
          method: "PUT",
          body,
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(response.status).toBe(400);
    }
    expect((await adminDb().doc(`publicScoreboards/${id}`).get()).exists).toBe(
      false,
    );
  });
  it("cannot take over an existing public scoreboard without ownership", async () => {
    await adminDb()
      .doc(`publicScoreboards/${id}`)
      .set({ name: "Existing board" });
    expect(
      (await publish(toScoreboard(tournament(), context.now))).status,
    ).toBe(409);
    expect((await read()).name).toBe("Existing board");
  });
});
