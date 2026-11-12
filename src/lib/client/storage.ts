/** Preserve saved sessions and sign-in state across the app rename. */
export function goldenPointStorage(): Storage {
  const storage = window.localStorage;
  const legacyPrefix = "padel.";
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (!key?.startsWith(legacyPrefix)) continue;
    const renamed = `golden-point.${key.slice(legacyPrefix.length)}`;
    if (storage.getItem(renamed) === null) {
      storage.setItem(renamed, storage.getItem(key)!);
    }
    storage.removeItem(key);
  }
  return storage;
}
