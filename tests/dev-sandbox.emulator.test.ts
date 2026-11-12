import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWeeklyDate } from "@/server/weekly-dates";
import { createHold, bookingStatus, withdraw } from "@/server/booking";
import { checkoutForm, confirmDevSandboxReturn } from "@/server/payments";
import { publicEvent } from "@/server/public";
import { adminDb } from "@/server/admin";
import { setMerchant, merchantInput } from "@/server/organiser";
import { clearFirestore, seedEvent } from "./helpers";

const input = { title: "Demo Sandbox Night", organiserName: "Demo Host", venue: "Demo Courts", date: "2099-11-12", startTime: "18:00", endTime: "19:30", playerLimit: 4, priceCents: 15000, devSandbox: true };
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("APP_BASE_URL", "http://localhost:3410");
  await clearFirestore();
});
afterEach(() => vi.unstubAllEnvs());
const setup = async () => {
  const date = await createWeeklyDate(input, null);
  const player = await createHold(date.id, { poolId: "pool1", displayName: "Demo Player", paymentMethod: "payfast" }, null);
  const form = await checkoutForm(player.registrationId, player.bookingToken);
  const fields = Object.fromEntries(form.fields);
  const nonce = new URL(fields.return_url!).searchParams.get("dev_return")!;
  return { date, player, form, fields, nonce };
};
it("offers public sandbox checkout to guests and confirms its successful return idempotently", async () => {
  const { date, player, form, fields, nonce } = await setup();
  expect(form.action).toBe("https://sandbox.payfast.co.za/eng/process");
  expect(fields.merchant_id).toBe("10000100");
  expect(fields.amount).toBe("150.00");
  expect(fields.notify_url).toBeUndefined();
  expect(fields.cancel_url).not.toContain("dev_return");
  expect(fields.return_url).toContain("http://127.0.0.1:3410/");
  expect(await bookingStatus(player.registrationId, player.bookingToken, null)).toMatchObject({ devSandbox: true, payfastConnected: true, registration: { payment: "pending" } });
  await expect(confirmDevSandboxReturn(player.registrationId, "wrong", nonce)).rejects.toThrow();
  await expect(confirmDevSandboxReturn(player.registrationId, player.bookingToken, "a".repeat(64))).rejects.toThrow();
  await confirmDevSandboxReturn(player.registrationId, player.bookingToken, nonce);
  await confirmDevSandboxReturn(player.registrationId, player.bookingToken, nonce);
  expect(await bookingStatus(player.registrationId, player.bookingToken, null)).toMatchObject({ registration: { attendance: "active", payment: "paid_online" } });
  expect((await publicEvent(date.id))?.pools[0]?.roster).toEqual([{ name: "Demo Player", paid: true }]);
  const payment = (await adminDb().doc(`payments/${player.registrationId}`).get()).data()!;
  expect(payment.devReturnConfirmed).toBe(true);
  expect(payment.devReturnHash).not.toBe(nonce);
  expect(payment.appliedNotifications).toHaveLength(1);
});
it("cannot confirm ordinary dates, unissued checkout returns or expired return links", async () => {
  const { date, player, nonce } = await setup();
  const other = await createHold(date.id, { poolId: "pool1", displayName: "Demo Other", paymentMethod: "payfast" }, null);
  await expect(confirmDevSandboxReturn(other.registrationId, other.bookingToken, nonce)).rejects.toThrow();
  await adminDb().doc(`payments/${player.registrationId}`).update({ devReturnExpiresAt: "2000-01-01T00:00:00.000Z" });
  await expect(confirmDevSandboxReturn(player.registrationId, player.bookingToken, nonce)).rejects.toThrow("expired");
  await adminDb().doc(`events/${date.id}`).update({ devSandbox: false });
  await expect(confirmDevSandboxReturn(player.registrationId, player.bookingToken, nonce)).rejects.toThrow("not a sandbox date");
});
it("cannot enable or confirm the bypass in production, even with a valid checkout nonce", async () => {
  const { date, player, nonce } = await setup();
  vi.stubEnv("NODE_ENV", "production");
  await expect(createWeeklyDate(input, null)).rejects.toThrow("DEV ONLY");
  await expect(confirmDevSandboxReturn(player.registrationId, player.bookingToken, nonce)).rejects.toThrow("disabled");
  await expect(checkoutForm(player.registrationId, player.bookingToken)).rejects.toThrow("Connect PayFast");
  expect((await publicEvent(date.id))?.payfastConnected).toBe(false);
});
it("uses existing late-payment settlement rules if a player withdraws before returning", async () => {
  const { player, nonce } = await setup();
  await withdraw(player.registrationId, null, new Date(), player.bookingToken);
  await confirmDevSandboxReturn(player.registrationId, player.bookingToken, nonce);
  expect(await bookingStatus(player.registrationId, player.bookingToken, null)).toMatchObject({ registration: { attendance: "withdrawn", settlement: "due", settlementCents: 15000 } });
});


const owner = { uid: "owner", emailVerified: true };
const sandboxDetails = { merchantId: "12345679", merchantKey: "sandbox-test-only", passphrase: "test-only-passphrase", sandbox: true };
async function connectedSandbox() {
  vi.stubEnv("GP_KEYS_SECRET", "ab".repeat(32));
  await seedEvent({ priceCents: 8000, devSandbox: false });
  await setMerchant("w1", owner, merchantInput.parse(sandboxDetails));
  const player = await createHold("e1", { poolId: "pool1", displayName: "Demo Player", paymentMethod: "payfast" }, null);
  const form = await checkoutForm(player.registrationId, player.bookingToken);
  const fields = Object.fromEntries(form.fields);
  const nonce = new URL(fields.return_url!).searchParams.get("dev_return")!;
  return { player, form, fields, nonce };
}

it("confirms an organiser's R80 sandbox payment on local return, without an ITN", async () => {
  const { player, form, fields, nonce } = await connectedSandbox();
  expect(form.action).toBe("https://sandbox.payfast.co.za/eng/process");
  expect(fields.merchant_id).toBe(sandboxDetails.merchantId);
  expect(fields.amount).toBe("80.00");
  expect(fields.notify_url).toBeUndefined();
  expect(fields.cancel_url).not.toContain("dev_return");
  expect(nonce).toMatch(/^[a-f0-9]{64}$/);
  expect(await bookingStatus(player.registrationId, player.bookingToken, null)).toMatchObject({ devSandbox: true, registration: { payment: "pending" } });
  expect((await publicEvent("e1"))?.devSandbox).toBe(true);
  await expect(confirmDevSandboxReturn(player.registrationId, "invalid-token", nonce)).rejects.toThrow();
  await expect(confirmDevSandboxReturn(player.registrationId, player.bookingToken, "a".repeat(64))).rejects.toThrow();
  await confirmDevSandboxReturn(player.registrationId, player.bookingToken, nonce);
  await confirmDevSandboxReturn(player.registrationId, player.bookingToken, nonce);
  expect(await bookingStatus(player.registrationId, player.bookingToken, null)).toMatchObject({ registration: { attendance: "active", payment: "paid_online", amountCents: 8000 } });
  const payment = (await adminDb().doc(`payments/${player.registrationId}`).get()).data()!;
  expect(payment.devReturnConfirmed).toBe(true);
  expect(payment.appliedNotifications).toHaveLength(1);
});

it("requires verified ITN for connected sandbox accounts in production", async () => {
  const { player, nonce } = await connectedSandbox();
  vi.stubEnv("NODE_ENV", "production");
  await expect(confirmDevSandboxReturn(player.registrationId, player.bookingToken, nonce)).rejects.toThrow("disabled");
  const form = await checkoutForm(player.registrationId, player.bookingToken);
  const fields = Object.fromEntries(form.fields);
  expect(form.action).toBe("https://sandbox.payfast.co.za/eng/process");
  expect(fields.return_url).not.toContain("dev_return");
  expect(fields.notify_url).toContain("/api/payfast/itn");
  expect(await bookingStatus(player.registrationId, player.bookingToken, null)).toMatchObject({ devSandbox: false, registration: { payment: "pending" } });
});

it("rejects connected sandbox returns after credentials change or the nonce expires", async () => {
  const { player, nonce } = await connectedSandbox();
  await adminDb().doc(`payments/${player.registrationId}`).update({ devReturnExpiresAt: "2000-01-01T00:00:00.000Z" });
  await expect(confirmDevSandboxReturn(player.registrationId, player.bookingToken, nonce)).rejects.toThrow("expired");
  const form = await checkoutForm(player.registrationId, player.bookingToken);
  const nextNonce = new URL(Object.fromEntries(form.fields).return_url!).searchParams.get("dev_return")!;
  await setMerchant("w1", owner, merchantInput.parse({ ...sandboxDetails, merchantId: "12345678" }));
  await expect(confirmDevSandboxReturn(player.registrationId, player.bookingToken, nextNonce)).rejects.toThrow();
  await setMerchant("w1", owner, merchantInput.parse({ ...sandboxDetails, sandbox: false }));
  await expect(confirmDevSandboxReturn(player.registrationId, player.bookingToken, nextNonce)).rejects.toThrow();
  const live = await checkoutForm(player.registrationId, player.bookingToken);
  expect(live.action).toBe("https://www.payfast.co.za/eng/process");
  expect(Object.fromEntries(live.fields).return_url).not.toContain("dev_return");
  expect((await bookingStatus(player.registrationId, player.bookingToken, null)).registration.payment).toBe("pending");
});

it("rejects local sandbox confirmation with a non-loopback return URL", async () => {
  const { player } = await connectedSandbox();
  vi.stubEnv("APP_BASE_URL", "https://example.com");
  await expect(checkoutForm(player.registrationId, player.bookingToken)).rejects.toThrow("loopback");
});
