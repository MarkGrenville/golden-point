/** Money is always integer cents in ZAR. */
export type Cents = number;

export function assertCents(value: number, label = "amount"): Cents {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer number of cents`);
  }
  return value;
}

export function formatRand(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100).toLocaleString("en-ZA").replace(/ /g, " ");
  return `${sign}R${rands}.${String(abs % 100).padStart(2, "0")}`;
}

/** PayFast amounts are decimal strings with two places. */
export function centsToDecimal(cents: Cents): string {
  assertCents(cents);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function decimalToCents(value: string): Cents {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid decimal amount: ${value}`);
  return Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
}
