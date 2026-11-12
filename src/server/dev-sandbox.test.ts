import { afterEach, describe, expect, it, vi } from "vitest";
import { devSandboxEnabled, isDevSandboxDate } from "./dev-sandbox";
import { POST } from "@/app/api/bookings/[id]/dev-sandbox-return/route";

afterEach(() => vi.unstubAllEnvs());
const local = () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("GCLOUD_PROJECT", "demo-golden-point");
  vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8180");
};
describe("DEV ONLY sandbox boundary", () => {
  it("requires an explicitly selected sandbox date and local development emulator", () => {
    local();
    expect(devSandboxEnabled()).toBe(true);
    expect(isDevSandboxDate({ devSandbox: true })).toBe(true);
    expect(isDevSandboxDate({})).toBe(false);
  });
  it.each([
    ["NODE_ENV", "production"], ["NODE_ENV", "test"],
    ["GCLOUD_PROJECT", "example-production-project"], ["GCLOUD_PROJECT", ""],
    ["FIRESTORE_EMULATOR_HOST", ""], ["FIRESTORE_EMULATOR_HOST", "remote.example:8180"],
  ])("fails closed with %s=%s", (key, value) => {
    local(); vi.stubEnv(key, value);
    expect(devSandboxEnabled()).toBe(false);
    expect(isDevSandboxDate({ devSandbox: true })).toBe(false);
  });
  it("rejects even a forged production request before database access", async () => {
    local(); vi.stubEnv("NODE_ENV", "production");
    const response = await POST(new Request("http://localhost/api/bookings/test/dev-sandbox-return", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "test" }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "DEV ONLY — return confirmation is disabled." });
  });
});
