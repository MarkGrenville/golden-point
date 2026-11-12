export const TIME_ZONE = "Africa/Johannesburg";
/** South Africa has no daylight saving: SAST is always UTC+02:00. */
const OFFSET = "+02:00";

/** Build an instant from a local SAST date ("2026-10-29") and time ("18:00"). */
export function sastInstant(date: string, time: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error(`Invalid SAST date/time: ${date} ${time}`);
  }
  return new Date(`${date}T${time}:00${OFFSET}`);
}

/** Local SAST calendar date (YYYY-MM-DD) of an instant. */
export function sastDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD calendar date. */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Explicit, unambiguous label for WhatsApp-shared messages, e.g. "Thu 29 Oct 2026, 18:00". */
export function formatSast(instant: Date, opts: { time?: boolean } = { time: true }): string {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(opts.time === false ? {} : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`;
  return opts.time === false ? day : `${day}, ${get("hour")}:${get("minute")}`;
}

export function formatSastTime(instant: Date): string {
  return new Intl.DateTimeFormat("en-ZA", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
}
