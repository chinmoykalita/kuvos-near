// Browser stand-in for expo-secure-store. The core keeps only non-secret drafts and
// preferences here; auth sessions live in API cookies, never in localStorage.
const prefix = 'kuvos-web:';

function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  return storage()?.getItem(prefix + key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  storage()?.setItem(prefix + key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  storage()?.removeItem(prefix + key);
}

export function getItem(key: string) {
  return storage()?.getItem(prefix + key) ?? null;
}

export function setItem(key: string, value: string) {
  storage()?.setItem(prefix + key, value);
}

export const AFTER_FIRST_UNLOCK = 0;
export const WHEN_UNLOCKED = 1;
export async function isAvailableAsync() {
  return !!storage();
}
