import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "@/server/admin";
import { createHold } from "@/server/booking";
import { applyVerifiedItn } from "@/server/payments";
import { applyAction, createCloudTournament } from "@/server/tournaments";
import { clearFirestore, guest, seedEvent } from "./helpers";

beforeEach(clearFirestore);
const owner = { uid: "owner", email: "owner@example.com", emailVerified: true };

describe("cloud tournaments", () => {
  it("imports twelve paid players plus two manual additions and runs on three courts", async () => {
    const e = await seedEvent(
      { allocationMode: "tournament_pool", format: "americano" },
      3,
    );
    await adminDb()
      .doc("events/e1")
      .update({ pools: [{ ...e.pools[0]!, playerLimit: 16 }] });
    for (let i = 0; i < 12; i++) {
      const h = await createHold(
        "e1",
        { ...guest(i), paymentMethod: "payfast" },
        null,
      );
      await applyVerifiedItn({
        mPaymentId: h.registrationId,
        pfPaymentId: `pf${i}`,
        status: "COMPLETE",
        grossCents: 15000,
        feeCents: 0,
        netCents: 15000,
        merchantId: "10000100",
      });
    }
    await expect(
      createCloudTournament(owner, {
        name: "Thu",
        eventId: "e1",
        rules: {
          format: "americano",
          rounds: 7,
          courts: 3,
          pointsPerMatch: 24,
          minutesPerRound: 15,
          lateEntrantsEligibleToWin: false,
        },
        participants: [{ name: "Walk-in" }],
      }),
    ).rejects.toThrow(/financial status/);
    const t = await createCloudTournament(owner, {
      name: "Thu",
      eventId: "e1",
      rules: {
        format: "americano",
        rounds: 7,
        courts: 3,
        pointsPerMatch: 24,
        minutesPerRound: 15,
        lateEntrantsEligibleToWin: false,
      },
      participants: [
        { name: "Walk-in A", financialStatus: "cash_received" },
        { name: "Walk-in B", financialStatus: "unpaid_exception" },
      ],
    });
    expect(t.participants).toHaveLength(14);
    expect(
      t.participants.filter((p) => p.financialStatus === "paid_online"),
    ).toHaveLength(12);
    const started = await applyAction(t.id, owner, {
      type: "start",
      expectedRevision: t.revision,
    });
    const round1 = started.rounds[0]!;
    expect(round1.matches).toHaveLength(3);
    expect(round1.resting).toHaveLength(2);
    const m = round1.matches[0]!;
    await applyAction(t.id, owner, {
      type: "result",
      matchId: m.id,
      expectedMatchRevision: m.revision,
      scoreA: 15,
      scoreB: 9,
    });
    // A second device with a stale revision cannot overwrite the result.
    await expect(
      applyAction(t.id, owner, {
        type: "result",
        matchId: m.id,
        expectedMatchRevision: m.revision,
        scoreA: 9,
        scoreB: 15,
      }),
    ).rejects.toThrow(/changed/);
    // Stale structural actions are rejected too.
    await expect(
      applyAction(t.id, owner, {
        type: "finish",
        expectedRevision: started.revision,
      }),
    ).rejects.toThrow(/another device/);
    // Strangers cannot score.
    await expect(
      applyAction(
        t.id,
        { uid: "x", emailVerified: false },
        {
          type: "result",
          matchId: m.id,
          expectedMatchRevision: 1,
          scoreA: 12,
          scoreB: 12,
        },
      ),
    ).rejects.toThrow(/Not permitted/);
    const board = (
      await adminDb().doc(`publicScoreboards/${t.id}`).get()
    ).data()!;
    expect(JSON.stringify(board)).not.toMatch(
      /paid_online|cash_received|registrationId|example\.com/,
    );
    expect(board.rounds[0].matches[0].scoreA).toBe(15);
  });
});
