import { afterEach, expect, it, vi } from "vitest";
import { goldenPointStorage } from "./storage";

afterEach(() => vi.unstubAllGlobals());

it("keeps sessions, offline scores and sign-in state through the rename without overwriting newer data", () => {
  const values = new Map([
    ["padel.tournament.old", '{"name":"Saved tournament"}'],
    ["padel.pending.old", '[{"matchId":"m1"}]'],
    ["padel.signin.email", "demo@example.com"],
    ["padel.tournament.new", "older"],
    ["golden-point.tournament.new", "newer"],
    ["other-app", "untouched"],
  ]);
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  vi.stubGlobal("window", { localStorage: storage });
  goldenPointStorage();
  goldenPointStorage();
  expect(values.get("golden-point.tournament.old")).toContain(
    "Saved tournament",
  );
  expect(values.get("golden-point.pending.old")).toContain("m1");
  expect(values.get("golden-point.signin.email")).toBe("demo@example.com");
  expect(values.get("golden-point.tournament.new")).toBe("newer");
  expect(values.get("other-app")).toBe("untouched");
  expect([...values.keys()].some((key) => key.startsWith("padel."))).toBe(
    false,
  );
});
