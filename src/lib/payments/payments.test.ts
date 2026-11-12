import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { allocationOnComplete, applyItn, type PaymentRecord } from "./ledger";
import {
  checkoutFields,
  itnParamString,
  pfSignature,
  validateItn,
  type ItnContext,
  type ItnPayload,
} from "./payfast";

const creds = {
  merchantId: "10000100",
  merchantKey: "46f0cd694581a",
  passphrase: "jt7NOE43FZPn",
  sandbox: true,
};

function signedItn(overrides: Record<string, string> = {}): [string, string][] {
  const fields: [string, string][] = Object.entries({
    m_payment_id: "reg_1",
    pf_payment_id: "1089250",
    payment_status: "COMPLETE",
    item_name: "Golden Point Thursdays",
    amount_gross: "150.00",
    amount_fee: "-5.18",
    amount_net: "144.82",
    custom_str1: "reg_1",
    name_first: "Sam",
    email_address: "sam@example.com",
    merchant_id: "10000100",
    ...overrides,
  });
  return [...fields, ["signature", pfSignature(fields, creds.passphrase)]];
}

const ctx = (o: Partial<ItnContext> = {}): ItnContext => ({
  creds,
  expectedAmountCents: 15000,
  sourceIp: "41.74.179.194",
  allowedIps: ["41.74.179.194"],
  confirmWithServer: async () => true,
  ...o,
});

describe("PayFast signatures", () => {
  it("matches PayFast's documented encoding (MD5 of ordered pairs + passphrase)", () => {
    const fields: [string, string][] = [
      ["merchant_id", "10000100"],
      ["item_name", "Golden Point Thu 5 Nov"],
      ["amount", "150.00"],
    ];
    const expected = createHash("md5")
      .update(
        "merchant_id=10000100&item_name=Golden+Point+Thu+5+Nov&amount=150.00&passphrase=jt7NOE43FZPn",
      )
      .digest("hex");
    expect(pfSignature(fields, creds.passphrase)).toBe(expected);
  });
  it("builds a server-priced checkout with the signature last", () => {
    const { fields, action } = checkoutFields(creds, {
      paymentId: "reg_1",
      amountCents: 15000,
      itemName: "Golden Point",
      firstName: "Sam",
      email: "s@example.com",
      returnUrl: "https://a/r",
      cancelUrl: "https://a/c",
      notifyUrl: "https://a/n",
      registrationId: "reg_1",
    });
    expect(action).toContain("sandbox");
    expect(fields.find(([k]) => k === "amount")![1]).toBe("150.00");
    expect(fields.at(-1)![0]).toBe("signature");
    expect(fields.some(([k]) => k === "item_description")).toBe(false);
  });
});

describe("ITN validation", () => {
  it("accepts a correctly signed, sourced, priced and server-confirmed notification", async () => {
    const r = await validateItn(signedItn(), ctx());
    expect(r.ok && r.payload).toMatchObject({
      status: "COMPLETE",
      grossCents: 15000,
      feeCents: 518,
      netCents: 14482,
    });
  });
  it("rejects tampering, wrong merchant, wrong amount, wrong source and server rejection", async () => {
    const tampered = signedItn().map(
      ([k, v]) => [k, k === "amount_gross" ? "1.00" : v] as [string, string],
    );
    expect(await validateItn(tampered, ctx())).toMatchObject({
      ok: false,
      reason: "signature",
    });
    expect(
      await validateItn(signedItn({ merchant_id: "999" }), ctx()),
    ).toMatchObject({ ok: false, reason: "merchant" });
    expect(
      await validateItn(signedItn({ amount_gross: "100.00" }), ctx()),
    ).toMatchObject({ ok: false, reason: "amount" });
    expect(
      await validateItn(signedItn(), ctx({ sourceIp: "1.2.3.4" })),
    ).toMatchObject({ ok: false, reason: "source" });
    expect(
      await validateItn(
        signedItn(),
        ctx({ confirmWithServer: async () => false }),
      ),
    ).toMatchObject({ ok: false, reason: "server_validation" });
  });
  it("posts back the exact parameter string without the signature", () => {
    expect(itnParamString(signedItn())).not.toContain("signature");
  });
});

const payment = (o: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: "reg_1",
  workspaceId: "w1",
  eventId: "e1",
  registrationId: "reg_1",
  method: "payfast",
  state: "initiated",
  amountCents: 15000,
  feeCents: 0,
  appliedNotifications: [],
  exceptions: [],
  createdAt: "t0",
  updatedAt: "t0",
  ...o,
});
const itn = (status: ItnPayload["status"], pf = "pf1"): ItnPayload => ({
  mPaymentId: "reg_1",
  pfPaymentId: pf,
  status,
  grossCents: 15000,
  feeCents: 518,
  netCents: 14482,
  merchantId: "10000100",
});

describe("notification ordering", () => {
  it("treats duplicates as no-ops", () => {
    const once = applyItn(payment(), itn("COMPLETE"), "t1").payment;
    expect(applyItn(once, itn("COMPLETE"), "t2").effect).toBe("duplicate");
  });
  it("ignores a PENDING that arrives after COMPLETE", () => {
    const done = applyItn(payment(), itn("COMPLETE"), "t1").payment;
    const r = applyItn(done, itn("PENDING"), "t2");
    expect(r.effect).toBe("exception");
    expect(r.payment.state).toBe("complete");
  });
  it("upgrades PENDING to COMPLETE and records fees", () => {
    const pending = applyItn(payment(), itn("PENDING"), "t1").payment;
    const r = applyItn(pending, itn("COMPLETE"), "t2");
    expect(r.payment).toMatchObject({ state: "complete", feeCents: 518 });
  });
  it("flags a second completed transaction for the same checkout", () => {
    const done = applyItn(payment(), itn("COMPLETE", "pf1"), "t1").payment;
    expect(applyItn(done, itn("COMPLETE", "pf2"), "t2").effect).toBe(
      "exception",
    );
  });
  it("lets FAILED then COMPLETE (retry) complete", () => {
    const failed = applyItn(payment(), itn("FAILED"), "t1").payment;
    expect(applyItn(failed, itn("COMPLETE"), "t2").payment.state).toBe(
      "complete",
    );
  });
});

describe("late payments", () => {
  const now = new Date("2026-11-02T18:00:00Z");
  it("confirms within the hold, allocates late only with capacity, otherwise reconciles", () => {
    expect(allocationOnComplete("held", "2026-11-02T18:05:00Z", 0, now)).toBe(
      "confirm",
    );
    expect(
      allocationOnComplete("released", "2026-11-02T17:50:00Z", 1, now),
    ).toBe("late_allocate");
    expect(
      allocationOnComplete("released", "2026-11-02T17:50:00Z", 0, now),
    ).toBe("late_no_capacity");
    expect(allocationOnComplete("active", undefined, 0, now)).toBe(
      "already_confirmed",
    );
  });
});
