import { describe, expect, it } from "vitest";
import { merchantInput, paymentLinkInput } from "./organiser";

describe("payment settings validation", () => {
  it("accepts HTTPS SnapScan and Zapper links and removal", () => {
    for (const paymentLink of ["https://pos.snapscan.io/qr/demo", "https://www.zapper.com/pay/demo", ""]) {
      expect(paymentLinkInput.parse({ paymentLink })).toEqual({ paymentLink });
    }
  });
  it("rejects unsafe links and links containing credentials", () => {
    for (const paymentLink of ["http://example.com/pay", "javascript:alert(1)", "https://user:password@example.com", "not a link", `https://example.com/${"a".repeat(2048)}`]) {
      expect(paymentLinkInput.safeParse({ paymentLink }).success).toBe(false);
    }
  });
  it("trims pasted credentials and enforces PayFast's passphrase limit", () => {
    expect(merchantInput.parse({ sandbox: false, merchantId: " 12345678 ", merchantKey: " test-only ", passphrase: " demo-passphrase " })).toMatchObject({ merchantId: "12345678", merchantKey: "test-only", passphrase: "demo-passphrase" });
    expect(merchantInput.safeParse({ sandbox: false, passphrase: "x".repeat(33) }).success).toBe(false);
    expect(merchantInput.safeParse({ sandbox: false, merchantId: "abc" }).success).toBe(false);
  });
  it("requires all three credentials in sandbox as well as live mode", () => {
    for (const sandbox of [true, false]) {
      const details = { sandbox, merchantId: "12345678", merchantKey: "test-key", passphrase: "test-passphrase" };
      expect(merchantInput.parse(details)).toEqual(details);
      for (const field of ["merchantId", "merchantKey", "passphrase"]) {
        expect(merchantInput.safeParse({ ...details, [field]: "" }).success).toBe(false);
        expect(merchantInput.safeParse({ ...details, [field]: undefined }).success).toBe(false);
      }
    }
  });
});
