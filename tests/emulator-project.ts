export const TEST_PROJECT_ID = "demo-golden-point-test";

/** Destructive test helpers must never accept the development or production project. */
export function assertTestEmulator(projectId = process.env.GCLOUD_PROJECT) {
  if (projectId !== TEST_PROJECT_ID || process.env.GCLOUD_PROJECT !== TEST_PROJECT_ID)
    throw new Error(`Emulator tests may only use ${TEST_PROJECT_ID}`);
  for (const variable of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[variable] ?? ""))
      throw new Error(`Emulator tests require a loopback ${variable}; run npm run test:emulator`);
  }
}
