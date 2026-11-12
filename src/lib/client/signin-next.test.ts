import { expect, it } from "vitest";
import { signInNext } from "./signin-next";

it("preserves local paths and private date fragments", () => {
  expect(signInNext("/admin/e/demo#private-token")).toBe("/admin/e/demo#private-token");
  expect(signInNext("/tournament/new")).toBe("/tournament/new");
});
it("rejects external and malformed sign-in destinations", () => {
  for (const next of [null, "https://example.com", "//example.com", "/\\example.com", "/\n/example.com", "/\t/example.com", "javascript:alert(1)"]) {
    expect(signInNext(next)).toBe("/me");
  }
});
