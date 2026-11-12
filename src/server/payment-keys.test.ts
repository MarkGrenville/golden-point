import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptKeys, decryptKeys } from "./payment-keys";
afterEach(() => vi.unstubAllEnvs());
describe("encrypted merchant credentials", () => {
  it("round trips without storing plaintext and randomises each save", () => {
    vi.stubEnv("GP_KEYS_SECRET", "ab".repeat(32));
    const keys = {
      merchantKey: "test-only-key",
      passphrase: "test-only-passphrase",
    };
    const a = encryptKeys(keys, "w1");
    expect(JSON.stringify(a)).not.toContain(keys.merchantKey);
    expect(decryptKeys(a, "w1")).toEqual(keys);
    expect(encryptKeys(keys, "w1")).not.toEqual(a);
  });
  it("rejects tampering, a different workspace and a different key", () => {
    vi.stubEnv("GP_KEYS_SECRET", "ab".repeat(32));
    const a = encryptKeys({ test: true }, "w1");
    expect(() => decryptKeys(a, "w2")).toThrow();
    expect(() =>
      decryptKeys({ ...a, tag: Buffer.alloc(16).toString("base64") }, "w1"),
    ).toThrow();
    vi.stubEnv("GP_KEYS_SECRET", "cd".repeat(32));
    expect(() => decryptKeys(a, "w1")).toThrow();
  });
  it("requires a server encryption key", () => {
    vi.stubEnv("GP_KEYS_SECRET", "");
    expect(() => encryptKeys({}, "w1")).toThrow("GP_KEYS_SECRET");
  });
});
