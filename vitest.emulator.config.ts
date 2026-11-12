import { defineConfig } from "vitest/config";
import path from "node:path";
import { TEST_PROJECT_ID } from "./tests/emulator-project";

// Override inherited dev-project settings before any Admin SDK import, including direct vitest runs.
process.env.GCLOUD_PROJECT = TEST_PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = TEST_PROJECT_ID;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = TEST_PROJECT_ID;

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { setupFiles: ["./tests/emulator-setup.ts"], include: ["tests/**/*.emulator.test.ts"], environment: "node", testTimeout: 30000, fileParallelism: false },
});
