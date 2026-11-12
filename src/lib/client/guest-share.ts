import { goldenPointStorage } from "./storage";
export interface GuestShare {
  id: string;
  token: string;
}
const key = (id: string) => `golden-point.share.${id}`;
export function loadGuestShare(id: string): GuestShare | null {
  const raw = goldenPointStorage().getItem(key(id));
  return raw ? JSON.parse(raw) : null;
}
export function createGuestShare(id: string): GuestShare {
  const existing = loadGuestShare(id);
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const share = {
    id: `guest-${crypto.randomUUID()}`,
    token: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    ),
  };
  // Persist before making a request so a reload/retry keeps the same link and ownership.
  goldenPointStorage().setItem(key(id), JSON.stringify(share));
  return share;
}
