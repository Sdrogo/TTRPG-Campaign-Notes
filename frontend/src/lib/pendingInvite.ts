const KEY = 'pendingInviteCode';

/**
 * Remembers an invitation code across the sign-in round trip. OAuth sends the
 * user back to the site origin, so the `/invite/:code` URL is otherwise lost.
 * Storage can be unavailable (private window, blocked site data): every access
 * is guarded and the invite then simply has to be reopened after signing in.
 */
export function savePendingInvite(code: string): void {
  try {
    sessionStorage.setItem(KEY, code);
  } catch {
    // Nothing to do: the user reopens the link after signing in.
  }
}

/** The invitation code saved before sign-in, if any. */
export function readPendingInvite(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Forgets the saved invitation code once it has been handed to the invite page. */
export function clearPendingInvite(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}
