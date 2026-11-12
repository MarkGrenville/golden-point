import type { AttendanceStatus, PaymentStatus } from "@/lib/booking/types";

/** Text labels for every state; colour is only a secondary cue. */
const ATTENDANCE: Record<AttendanceStatus, [string, string]> = {
  held: ["warn", "Place held — payment pending"],
  active: ["ok", "Place confirmed"],
  withdrawn: ["neutral", "Withdrawn"],
  released: ["neutral", "Place released"],
  attended: ["ok", "Attended"],
  no_show: ["bad", "No-show"],
};
const PAYMENT: Record<PaymentStatus, [string, string]> = {
  unpaid: ["bad", "Unpaid"],
  pending: ["warn", "Payment pending"],
  paid_online: ["ok", "Paid online"],
  paid_externally: ["ok", "Paid externally"],
  cash_received: ["ok", "Cash received"],
  fee_waived: ["neutral", "No fee"],
  late_unallocated: [
    "bad",
    "Paid late — no place available, settle with organiser",
  ],
};
export function AttendanceBadge({
  s,
  awaitingEvent,
}: {
  s: AttendanceStatus;
  awaitingEvent?: boolean;
}) {
  if (s === "active" && awaitingEvent)
    return (
      <span className="badge warn">Paid — awaiting event confirmation</span>
    );
  const [c, l] = ATTENDANCE[s];
  return <span className={`badge ${c}`}>{l}</span>;
}
export function PaymentBadge({ s }: { s: PaymentStatus }) {
  const [c, l] = PAYMENT[s];
  return <span className={`badge ${c}`}>{l}</span>;
}
