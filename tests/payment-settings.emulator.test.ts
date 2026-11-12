import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminDb } from "@/server/admin";
import { bookingStatus, createHold } from "@/server/booking";
import { pfSignature } from "@/lib/payments/payfast";
import { decryptKeys } from "@/server/payment-keys";
import { checkoutForm, merchantCredentials, recordManualPayment } from "@/server/payments";
import {
  merchantInput, paymentLinkInput, paymentSettings, setMerchant,
  setPaymentLink, workspaceOverview,
} from "@/server/organiser";
import { publicEvent } from "@/server/public";
import { clearFirestore, guest, seedEvent } from "./helpers";

const owner = { uid: "owner", emailVerified: true };
const credentials = { merchantId: "12345678", merchantKey: "test-key-4f2a", passphrase: "test-passphrase", sandbox: false };
beforeEach(async () => {
  await clearFirestore();
  await seedEvent();
  await adminDb().doc("workspaces/w1").update({ merchant: { status: "none", sandbox: false } });
});
afterEach(() => vi.unstubAllEnvs());

describe("organiser payment settings", () => {
  it("encrypts all credentials and exposes only a connection summary", async () => {
    vi.stubEnv("GP_KEYS_SECRET", "ab".repeat(32));
    await setMerchant("w1", owner, merchantInput.parse(credentials));
    const stored = (await adminDb().doc("merchants/w1").get()).data()!;
    const decrypted = decryptKeys(stored.encrypted, "w1");
    expect(decrypted).toEqual({ merchantId: credentials.merchantId, merchantKey: credentials.merchantKey, passphrase: credentials.passphrase });
    expect(await merchantCredentials("w1")).toEqual(credentials);
    const settings = await paymentSettings("w1", owner);
    expect(settings).toEqual({ name: "Thursday", merchant: { status: "verified", sandbox: false, suffix: "4f2a" }, paymentLink: "" });
    for (const response of [stored, settings, await workspaceOverview("w1", owner), await publicEvent("e1")]) {
      const json = JSON.stringify(response);
      for (const secret of [credentials.merchantId, credentials.merchantKey, credentials.passphrase]) expect(json).not.toContain(secret);
    }
    expect((await publicEvent("e1"))?.payfastConnected).toBe(true);
  });

  it("saves a payment link without PayFast or an encryption key, then marks payment by hand", async () => {
    vi.stubEnv("GP_KEYS_SECRET", "");
    const paymentLink = "https://pos.snapscan.io/qr/demo-only";
    await setPaymentLink("w1", owner, paymentLinkInput.parse({ paymentLink }));
    expect((await adminDb().doc("merchants/w1").get()).exists).toBe(false);
    expect(await paymentSettings("w1", owner)).toMatchObject({ paymentLink, merchant: { status: "none" } });
    expect(await publicEvent("e1")).toMatchObject({ paymentLink, payfastConnected: false });
    const booking = await createHold("e1", guest(1), null);
    expect(await bookingStatus(booking.registrationId, booking.bookingToken, null)).toMatchObject({ paymentLink, registration: { payment: "unpaid" } });
    await recordManualPayment(booking.registrationId, { method: "external_transfer", amountCents: 15000, note: "SnapScan checked" }, owner.uid);
    expect((await publicEvent("e1"))?.pools[0]?.roster[0]?.paid).toBe(true);
    await setPaymentLink("w1", owner, { paymentLink: "" });
    expect((await publicEvent("e1"))?.paymentLink).toBe(null);
  });

  it("preserves the PayFast connection when changing a link and preserves the link when replacing keys", async () => {
    vi.stubEnv("GP_KEYS_SECRET", "ab".repeat(32));
    await setMerchant("w1", owner, merchantInput.parse(credentials));
    const saved = (await adminDb().doc("merchants/w1").get()).data();
    await setPaymentLink("w1", owner, { paymentLink: "https://www.zapper.com/pay/demo-only" });
    expect((await adminDb().doc("merchants/w1").get()).data()).toEqual(saved);
    await setMerchant("w1", owner, merchantInput.parse({ ...credentials, merchantKey: "replacement-test-key" }));
    expect((await paymentSettings("w1", owner)).paymentLink).toBe("https://www.zapper.com/pay/demo-only");
    expect((await paymentSettings("w1", owner)).merchant.suffix).toBe("-key");
    await setMerchant("w1", owner, merchantInput.parse({ ...credentials, sandbox: true }));
    expect((await merchantCredentials("w1")).sandbox).toBe(true);
  });

  it("rejects other users and scorers before accessing credentials or updating settings", async () => {
    for (const uid of ["scorer1", "outsider"]) {
      const caller = { uid, emailVerified: true };
      await expect(paymentSettings("w1", caller)).rejects.toThrow();
      await expect(setPaymentLink("w1", caller, { paymentLink: "https://example.com" })).rejects.toThrow();
      await expect(setMerchant("w1", caller, merchantInput.parse(credentials))).rejects.toThrow();
    }
    expect((await adminDb().doc("merchants/w1").get()).exists).toBe(false);
  });

  it("encrypts custom sandbox credentials and uses them for the date’s checkout", async () => {
    vi.stubEnv("GP_KEYS_SECRET", "ab".repeat(32));
    const sandboxKeys = { merchantId: "12345679", merchantKey: "sandbox-test-7b2c", passphrase: "sandbox-test-passphrase", sandbox: true };
    await setMerchant("w1", owner, merchantInput.parse(sandboxKeys));
    const stored = (await adminDb().doc("merchants/w1").get()).data()!;
    expect(decryptKeys(stored.encrypted, "w1")).toEqual({ merchantId: sandboxKeys.merchantId, merchantKey: sandboxKeys.merchantKey, passphrase: sandboxKeys.passphrase });
    expect(await merchantCredentials("w1", "e1")).toEqual(sandboxKeys);
    expect(await paymentSettings("w1", owner)).toMatchObject({ merchant: { status: "verified", sandbox: true, suffix: "7b2c" } });
    for (const response of [stored, await paymentSettings("w1", owner), await publicEvent("e1")]) {
      for (const secret of [sandboxKeys.merchantId, sandboxKeys.merchantKey, sandboxKeys.passphrase]) expect(JSON.stringify(response)).not.toContain(secret);
    }
    const player = await createHold("e1", { ...guest(1), paymentMethod: "payfast" }, null);
    const checkout = await checkoutForm(player.registrationId, player.bookingToken);
    const fields = Object.fromEntries(checkout.fields);
    expect(checkout.action).toBe("https://sandbox.payfast.co.za/eng/process");
    expect(fields.merchant_id).toBe(sandboxKeys.merchantId);
    expect(fields.merchant_key).toBe(sandboxKeys.merchantKey);
    expect(fields.passphrase).toBeUndefined();
    expect(fields.signature).toBe(pfSignature(checkout.fields, sandboxKeys.passphrase));
    expect(fields.notify_url).toContain("/api/payfast/itn");
    expect(fields.return_url).not.toContain("dev_return");
    // Switching back to live uses the same encrypted credential path and live host.
    await setMerchant("w1", owner, merchantInput.parse(credentials));
    expect((await checkoutForm(player.registrationId, player.bookingToken)).action).toBe("https://www.payfast.co.za/eng/process");
  });

  it("rejects incomplete live credentials instead of silently using a sandbox merchant ID", async () => {
    vi.stubEnv("GP_KEYS_SECRET", "ab".repeat(32));
    for (const field of ["merchantId", "merchantKey", "passphrase"]) {
      await expect(setMerchant("w1", owner, { ...credentials, [field]: "" })).rejects.toThrow("Enter your PayFast");
    }
  });
});
