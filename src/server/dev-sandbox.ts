import type { EventDate } from "@/lib/booking/types";

/** Fail closed: synthetic confirmations can only touch the local demo emulator. */
export function devSandboxEnabled(): boolean {
  return process.env.NODE_ENV === "development"
    && ["demo-golden-point", "demo-golden-point-test"].includes(process.env.GCLOUD_PROJECT ?? "")
    && /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "");
}

export function isDevSandboxDate(event: Pick<EventDate, "devSandbox">): boolean {
  return devSandboxEnabled() && event.devSandbox === true;
}

/** Settings-connected sandbox accounts get the same local return simulation as guest dates. */
export function isDevSandboxConnection(merchant?: { status?: string; sandbox?: boolean }): boolean {
  return devSandboxEnabled() && merchant?.status === "verified" && merchant.sandbox === true;
}

// PayFast's published shared sandbox merchant; these are public test credentials.
// https://developers.payfast.co.za/docs/itn-instant-transaction-notification/
export const PUBLIC_SANDBOX_MERCHANT = {
  merchantId: "10000100", merchantKey: "46f0cd694581a", passphrase: "jt7NOE43FZPn", sandbox: true,
} as const;
