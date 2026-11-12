/** Keep authentication returns on this app, including private date fragments. */
export function signInNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20]/.test(value)) return '/me';
  return value;
}
