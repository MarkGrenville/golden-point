import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTestEmulator, TEST_PROJECT_ID } from "../../tests/emulator-project";

afterEach(() => vi.unstubAllEnvs());
describe("destructive emulator test isolation", () => {
  function localTestEnvironment() {
    vi.stubEnv("GCLOUD_PROJECT", TEST_PROJECT_ID);
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8280");
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9510");
  }
  it("accepts only the isolated test project on local emulators", () => {
    localTestEnvironment();
    expect(() => assertTestEmulator(TEST_PROJECT_ID)).not.toThrow();
  });
  it("rejects the dev project, production, and SDK project mismatches", () => {
    localTestEnvironment();
    for (const project of ["demo-golden-point", "example-production-project", "other"]) {
      expect(() => assertTestEmulator(project)).toThrow();
    }
    vi.stubEnv("GCLOUD_PROJECT", "demo-golden-point");
    expect(() => assertTestEmulator(TEST_PROJECT_ID)).toThrow();
  });
  it("rejects absent or remote emulator hosts", () => {
    for (const variable of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
      for (const host of ["", "firestore.googleapis.com:443", "192.168.1.2:8280"]) {
        localTestEnvironment();
        vi.stubEnv(variable, host);
        expect(() => assertTestEmulator()).toThrow();
      }
    }
  });
});
