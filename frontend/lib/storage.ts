// Thin wrapper so callers don't need try/catch or SSR guards scattered everywhere.
// Safe to call from the server (no-ops) since localStorage doesn't exist there.

export function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable (private browsing) - non-fatal for a demo app
  }
}
