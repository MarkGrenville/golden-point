import type { Registration } from "./types";

/** Money is settled in person; this record never triggers a provider operation. */
export function settlementFor(
  reg: Registration,
): Pick<Registration, "settlement" | "settlementCents"> {
  if (reg.settlement === "settled")
    return {
      settlement: "settled",
      settlementCents: reg.settlementCents ?? reg.amountCents,
    };
  const paid = [
    "paid_online",
    "paid_externally",
    "cash_received",
    "late_unallocated",
  ].includes(reg.payment);
  return {
    settlement: paid && reg.amountCents > 0 ? "due" : "none",
    settlementCents: paid ? reg.amountCents : 0,
  };
}
