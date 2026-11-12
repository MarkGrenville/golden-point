import { afterEach, expect, it, vi } from "vitest";
import { createGuestShare, loadGuestShare } from "./guest-share";

afterEach(() => vi.unstubAllGlobals());
it("persists ownership before uploading and reuses the same share after a reload or retry", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  expect(loadGuestShare("local-demo")).toBe(null);
  const share = createGuestShare("local-demo");
  expect(share.token).toMatch(/^[a-f0-9]{64}$/);
  expect(share.id).toMatch(/^guest-/);
  expect(loadGuestShare("local-demo")).toEqual(share);
  expect(createGuestShare("local-demo")).toEqual(share);
  expect(createGuestShare("another-tournament")).not.toEqual(share);
});
