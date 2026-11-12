import { createHash } from "node:crypto";
import { centsToDecimal, decimalToCents, type Cents } from "@/lib/shared/money";

/**
 * PayFast hosted checkout and ITN validation.
 * https://developers.payfast.co.za/docs#step_1_form_fields
 * https://developers.payfast.co.za/docs/itn-instant-transaction-notification/
 */

export const PAYFAST_HOSTS = {
  live: { process: "https://www.payfast.co.za/eng/process", validate: "https://www.payfast.co.za/eng/query/validate" },
  sandbox: { process: "https://sandbox.payfast.co.za/eng/process", validate: "https://sandbox.payfast.co.za/eng/query/validate" },
} as const;

/** Hostnames whose resolved addresses may send ITNs. */
export const PAYFAST_ITN_HOSTS = ["www.payfast.co.za", "sandbox.payfast.co.za", "w1w.payfast.co.za", "w2w.payfast.co.za"];

export interface MerchantCredentials {
  merchantId: string;
  merchantKey: string;
  passphrase?: string;
  sandbox: boolean;
}

/** PayFast's documented encoding: encodeURIComponent with spaces as "+". */
export function pfEncode(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%20/g, "+");
}

/** Signature over fields in the given order, skipping empty values, with the passphrase appended. */
export function pfSignature(fields: [string, string][], passphrase?: string): string {
  const parts = fields.filter(([k, v]) => k !== "signature" && v !== "").map(([k, v]) => `${k}=${pfEncode(v)}`);
  if (passphrase) parts.push(`passphrase=${pfEncode(passphrase)}`);
  return createHash("md5").update(parts.join("&")).digest("hex");
}

export interface CheckoutInput {
  paymentId: string;
  amountCents: Cents;
  itemName: string;
  itemDescription?: string;
  firstName: string;
  email: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl?: string;
  registrationId: string;
}

/** Ordered checkout fields as required by PayFast's signature. */
export function checkoutFields(creds: MerchantCredentials, input: CheckoutInput): { action: string; fields: [string, string][] } {
  const fields: [string, string][] = [
    ["merchant_id", creds.merchantId],
    ["merchant_key", creds.merchantKey],
    ["return_url", input.returnUrl],
    ["cancel_url", input.cancelUrl],
    ["notify_url", input.notifyUrl ?? ""],
    ["name_first", input.firstName.slice(0, 100)],
    ["email_address", input.email],
    ["m_payment_id", input.paymentId],
    ["amount", centsToDecimal(input.amountCents)],
    ["item_name", input.itemName.slice(0, 100)],
    ["item_description", (input.itemDescription ?? "").slice(0, 255)],
    ["custom_str1", input.registrationId],
  ];
  const nonEmpty = fields.filter(([, v]) => v !== "");
  nonEmpty.push(["signature", pfSignature(nonEmpty, creds.passphrase)]);
  return { action: creds.sandbox ? PAYFAST_HOSTS.sandbox.process : PAYFAST_HOSTS.live.process, fields: nonEmpty };
}

export type ItnStatus = "COMPLETE" | "FAILED" | "PENDING" | "CANCELLED";

export interface ItnPayload {
  mPaymentId: string;
  pfPaymentId: string;
  status: ItnStatus;
  grossCents: Cents;
  feeCents: Cents;
  netCents: Cents;
  merchantId: string;
  registrationId?: string;
}

/** Parse an ITN body preserving field order (required for the signature check). */
export function parseItnBody(body: string): [string, string][] {
  return body
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const [k, v = ""] = pair.split("=");
      return [decodeURIComponent(k!.replace(/\+/g, " ")), decodeURIComponent(v.replace(/\+/g, " "))] as [string, string];
    });
}

export type ItnCheck =
  | { ok: true; payload: ItnPayload }
  | { ok: false; reason: "signature" | "merchant" | "amount" | "source" | "server_validation" | "malformed"; detail?: string };

export interface ItnContext {
  creds: MerchantCredentials;
  expectedAmountCents: Cents;
  sourceIp: string | null;
  /** Resolved addresses of PAYFAST_ITN_HOSTS; injected so tests stay offline. */
  allowedIps: string[];
  /** POSTs the param string back to PayFast and returns true on "VALID". */
  confirmWithServer: (paramString: string) => Promise<boolean>;
}

export function itnParamString(fields: [string, string][]): string {
  return fields
    .filter(([k]) => k !== "signature")
    .map(([k, v]) => `${k}=${pfEncode(v)}`)
    .join("&");
}

/** All four PayFast security checks, cheapest first. */
export async function validateItn(fields: [string, string][], ctx: ItnContext): Promise<ItnCheck> {
  const get = (k: string) => fields.find(([key]) => key === k)?.[1];
  const signature = get("signature");
  const status = get("payment_status");
  const mPaymentId = get("m_payment_id");
  const pfPaymentId = get("pf_payment_id");
  const gross = get("amount_gross");
  if (!signature || !status || !mPaymentId || !pfPaymentId || !gross) return { ok: false, reason: "malformed" };
  if (!["COMPLETE", "FAILED", "PENDING", "CANCELLED"].includes(status)) return { ok: false, reason: "malformed", detail: status };

  const ownFields = fields.filter(([k]) => k !== "signature");
  if (pfSignature(ownFields, ctx.creds.passphrase) !== signature) return { ok: false, reason: "signature" };
  if (get("merchant_id") !== ctx.creds.merchantId) return { ok: false, reason: "merchant" };

  let grossCents: Cents;
  try {
    grossCents = decimalToCents(gross);
  } catch {
    return { ok: false, reason: "malformed", detail: "amount_gross" };
  }
  // PayFast allows a 1-cent tolerance; we require exact cents.
  if (grossCents !== ctx.expectedAmountCents) return { ok: false, reason: "amount", detail: `${grossCents} != ${ctx.expectedAmountCents}` };
  if (!ctx.sourceIp || !ctx.allowedIps.includes(ctx.sourceIp)) return { ok: false, reason: "source", detail: ctx.sourceIp ?? "unknown" };
  if (!(await ctx.confirmWithServer(itnParamString(fields)))) return { ok: false, reason: "server_validation" };

  const fee = get("amount_fee") ?? "0.00";
  const feeCents = Math.abs(decimalToCents(fee.replace(/^-/, "")));
  return {
    ok: true,
    payload: {
      mPaymentId,
      pfPaymentId,
      status: status as ItnStatus,
      grossCents,
      feeCents,
      netCents: get("amount_net") ? decimalToCents(get("amount_net")!) : grossCents - feeCents,
      merchantId: get("merchant_id")!,
      registrationId: get("custom_str1"),
    },
  };
}

export async function confirmWithPayfast(paramString: string, sandbox: boolean): Promise<boolean> {
  const res = await fetch(sandbox ? PAYFAST_HOSTS.sandbox.validate : PAYFAST_HOSTS.live.validate, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: paramString,
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.text()).trim() === "VALID";
}

export async function resolvePayfastIps(): Promise<string[]> {
  const { promises: dns } = await import("node:dns");
  const lists = await Promise.all(PAYFAST_ITN_HOSTS.map((h) => dns.resolve4(h).catch(() => [] as string[])));
  return lists.flat();
}
