import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "@/server/admin";
import {
  createHold,
  withdraw,
  joinWaitlist,
  bookingStatus,
  expireEventHolds,
  waitingStatus,
  acceptCash,
} from "@/server/booking";
import {
  applyVerifiedItn,
  recordManualPayment,
  settle,
} from "@/server/payments";
import { cancelEvent, setMerchant } from "@/server/organiser";
import { publicEvent } from "@/server/public";
import { clearFirestore, seedEvent, guest } from "./helpers";
const owner = { uid: "owner", emailVerified: true };
const db = () => adminDb();
const reg = async (id: string) =>
  (await db().doc(`registrations/${id}`).get()).data()!;
const online = (i: number) => ({
  ...guest(i),
  paymentMethod: "payfast" as const,
});
const paid = (id: string) =>
  applyVerifiedItn({
    mPaymentId: id,
    pfPaymentId: `pf_${id}`,
    status: "COMPLETE",
    grossCents: 15000,
    feeCents: 500,
    netCents: 14500,
    merchantId: "10000100",
  });
beforeEach(async () => {
  await clearFirestore();
  await seedEvent();
});
describe("weekly group places", () => {
  it("cannot oversell when players race for four places", async () => {
    const r = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => createHold("e1", guest(i), null)),
    );
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(4);
  });
  it("joins for cash/EFT without an account, then organiser marks paid", async () => {
    const p = await createHold(
      "e1",
      { poolId: "pool1", displayName: "Demo Player" },
      null,
    );
    expect(await reg(p.registrationId)).toMatchObject({
      attendance: "active",
      payment: "unpaid",
    });
    await recordManualPayment(
      p.registrationId,
      { method: "cash", amountCents: 15000, note: "" },
      owner.uid,
    );
    expect(await reg(p.registrationId)).toMatchObject({
      payment: "cash_received",
    });
    expect((await publicEvent("e1"))?.pools[0]?.roster[0]?.paid).toBe(true);
  });
  it("authorises private guest links and records paid drop-outs for settlement", async () => {
    const p = await createHold("e1", online(1), null);
    await paid(p.registrationId);
    await expect(
      withdraw(p.registrationId, null, new Date(), "wrong"),
    ).rejects.toThrow();
    await withdraw(p.registrationId, null, new Date(), p.bookingToken);
    expect(await reg(p.registrationId)).toMatchObject({
      attendance: "withdrawn",
      settlement: "due",
      settlementCents: 15000,
    });
    await settle(p.registrationId, owner.uid);
    await settle(p.registrationId, owner.uid);
    expect((await reg(p.registrationId)).settlement).toBe("settled");
  });
  it("offers a vacancy to the first waiter and exposes the offer on their private link", async () => {
    const places = await Promise.all(
      Array.from({ length: 4 }, (_, i) => createHold("e1", guest(i), null)),
    );
    const first = await joinWaitlist(
      "e1",
      {
        displayName: "First Demo",
        email: "first@example.com",
        poolIds: ["pool1"],
      },
      null,
      new Date(Date.now() - 1000),
    );
    await joinWaitlist(
      "e1",
      {
        displayName: "Second Demo",
        email: "second@example.com",
        poolIds: ["pool1"],
      },
      null,
    );
    await withdraw(
      places[0]!.registrationId,
      null,
      new Date(),
      places[0]!.bookingToken,
    );
    const status = await waitingStatus(first.id, first.token);
    expect(status).toMatchObject({ status: "offered" });
    const e = await publicEvent("e1");
    expect(e?.waiting[0]).toEqual({ name: "First Demo", status: "offered" });
    expect(JSON.stringify(e)).not.toContain("first@example.com");
    const offered = (await db().doc(`waitlist/${first.id}`).get()).data()!;
    await acceptCash(offered.offer.registrationId, offered.bookingToken);
    expect(await reg(offered.offer.registrationId)).toMatchObject({
      attendance: "active",
      payment: "unpaid",
    });
  });
  it("keeps a guest's private waiting link usable through an offer and cash acceptance", async () => {
    const places = await Promise.all(
      Array.from({ length: 4 }, (_, i) => createHold("e1", guest(i), null)),
    );
    const waiter = await joinWaitlist("e1", {
      displayName: "Demo Waiting Player", email: "", poolIds: ["pool1"],
    }, null);
    await expect(waitingStatus(waiter.id, "wrong-token")).rejects.toThrow();
    expect(await waitingStatus(waiter.id, waiter.token)).toMatchObject({ status: "waiting", url: null });
    await withdraw(places[0]!.registrationId, null, new Date(), places[0]!.bookingToken);
    const offer = await waitingStatus(waiter.id, waiter.token);
    expect(offer.status).toBe("offered");
    const privateUrl = new URL(offer.url!, "http://localhost");
    const registrationId = privateUrl.pathname.split("/").at(-1)!;
    const bookingToken = privateUrl.searchParams.get("t")!;
    await expect(acceptCash(registrationId, "wrong-token")).rejects.toThrow();
    await acceptCash(registrationId, bookingToken);
    expect(await waitingStatus(waiter.id, waiter.token)).toMatchObject({ status: "accepted", url: offer.url });
    expect(await bookingStatus(registrationId, bookingToken, null)).toMatchObject({ registration: { attendance: "active", payment: "unpaid" } });
    const shared = await publicEvent("e1");
    expect(shared?.pools[0]?.roster).toContainEqual({ name: "Demo Waiting Player", paid: false });
    expect(shared?.waiting).toHaveLength(0);
    expect(JSON.stringify(shared)).not.toContain(bookingToken);
    expect(JSON.stringify(shared)).not.toContain(waiter.token);
  });
  it("expires holds on reads and keeps late notifications idempotent", async () => {
    const old = new Date(Date.now() - 11 * 60000);
    const p = await createHold("e1", online(1), null, old);
    await publicEvent("e1");
    expect((await reg(p.registrationId)).attendance).toBe("released");
    await Promise.all(
      Array.from({ length: 4 }, (_, i) => createHold("e1", guest(i + 2), null)),
    );
    await paid(p.registrationId);
    await paid(p.registrationId);
    expect(await reg(p.registrationId)).toMatchObject({
      payment: "late_unallocated",
      settlement: "due",
      attendance: "released",
    });
  });
  it("cancels a date without reviving late payments or resetting settled money", async () => {
    const p = await createHold("e1", online(1), null);
    await paid(p.registrationId);
    await cancelEvent("e1", "Called off", owner);
    await settle(p.registrationId, owner.uid);
    await cancelEvent("e1", "Still cancelled", owner);
    expect((await reg(p.registrationId)).settlement).toBe("settled");
    expect((await publicEvent("e1"))?.status).toBe("cancelled");
    await expect(createHold("e1", guest(2), null)).rejects.toThrow();
  });
  it("stores only encrypted credentials, and public reads contain no keys", async () => {
    process.env.GP_KEYS_SECRET = "ab".repeat(32);
    await setMerchant("w1", owner, {
      merchantId: "12345678",
      merchantKey: "test-key-1234",
      passphrase: "test-passphrase",
      sandbox: false,
    });
    const stored = (await db().doc("merchants/w1").get()).data();
    expect(JSON.stringify(stored)).not.toContain("test-key-1234");
    expect(JSON.stringify(await publicEvent("e1"))).not.toContain(
      "test-passphrase",
    );
    delete process.env.GP_KEYS_SECRET;
  });
  it("advances an expired waiting-list offer on a date read", async () => {
    const places = await Promise.all(
      Array.from({ length: 4 }, (_, i) => createHold("e1", guest(i), null)),
    );
    const first = await joinWaitlist(
      "e1",
      {
        displayName: "First Demo",
        email: "first@example.com",
        poolIds: ["pool1"],
      },
      null,
      new Date(Date.now() - 1000),
    );
    const second = await joinWaitlist(
      "e1",
      {
        displayName: "Second Demo",
        email: "second@example.com",
        poolIds: ["pool1"],
      },
      null,
    );
    await withdraw(
      places[0]!.registrationId,
      null,
      new Date(),
      places[0]!.bookingToken,
    );
    const offered = (await db().doc(`waitlist/${first.id}`).get()).data()!;
    await db()
      .doc(`registrations/${offered.offer.registrationId}`)
      .update({ holdExpiresAt: new Date(Date.now() - 1000).toISOString() });
    await publicEvent("e1");
    expect((await db().doc(`waitlist/${first.id}`).get()).data()?.status).toBe(
      "expired",
    );
    expect(await waitingStatus(second.id, second.token)).toMatchObject({
      status: "offered",
    });
  });
  it("records an ITN after cancellation as money to settle, with no place", async () => {
    const p = await createHold("e1", online(1), null);
    await cancelEvent("e1", "Called off", owner);
    await paid(p.registrationId);
    expect(await reg(p.registrationId)).toMatchObject({
      attendance: "released",
      settlement: "due",
      settlementCents: 15000,
    });
    expect((await publicEvent("e1"))?.pools[0]?.roster).toHaveLength(0);
  });
  it("does not undo an organiser's cash receipt when an abandoned checkout fails", async () => {
    const p = await createHold("e1", online(1), null);
    await acceptCash(p.registrationId, p.bookingToken);
    await recordManualPayment(
      p.registrationId,
      { method: "cash", amountCents: 15000, note: "" },
      owner.uid,
    );
    await applyVerifiedItn({
      mPaymentId: p.registrationId,
      pfPaymentId: "failed-checkout",
      status: "FAILED",
      grossCents: 15000,
      feeCents: 0,
      netCents: 15000,
      merchantId: "10000100",
    });
    expect(await reg(p.registrationId)).toMatchObject({
      attendance: "active",
      payment: "cash_received",
    });
  });
  it("does not revive expired holds when marking a payment by hand", async () => {
    const p = await createHold("e1", online(1), null, new Date(Date.now() - 11 * 60000));
    await expect(recordManualPayment(p.registrationId, { method: "cash", amountCents: 15000, note: "" }, owner.uid)).rejects.toThrow("no longer has a place");
    expect((await reg(p.registrationId)).attendance).toBe("released");
  });
  it("enforces the single drop-out deadline", async () => {
    const p = await createHold("e1", guest(1), null);
    await db()
      .doc("events/e1")
      .update({ dropOutBefore: new Date(Date.now() - 1000).toISOString() });
    await expect(
      withdraw(p.registrationId, null, new Date(), p.bookingToken),
    ).rejects.toThrow("deadline");
  });
});
