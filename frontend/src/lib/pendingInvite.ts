const INVITE_KEY = 'pendingInviteCode';
const FRIEND_KEY = 'pendingFriendCode';
const SIGN_IN_KEY = 'pendingSignIn';

/*
 * Remembers a code from a shared link, or that a sign-in was just started,
 * across the sign-in round trip. OAuth
 * sends the user back to the site origin, so the `/invite/:code` or
 * `/friends/add/:code` URL is otherwise lost. Storage can be unavailable
 * (private window, blocked site data): every access is guarded and the link
 * then simply has to be reopened after signing in.
 */

function save(key: string, code: string): void {
  try {
    sessionStorage.setItem(key, code);
  } catch {
    // Nothing to do: the user reopens the link after signing in.
  }
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function clear(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** Remembers an invitation code until the user is signed in. */
export function savePendingInvite(code: string): void {
  save(INVITE_KEY, code);
}

/** The invitation code saved before sign-in, if any. */
export function readPendingInvite(): string | null {
  return read(INVITE_KEY);
}

/** Forgets the saved invitation code once it has been handed to the invite page. */
export function clearPendingInvite(): void {
  clear(INVITE_KEY);
}

/** Remembers a Friend code from a friend link until the user is signed in. */
export function savePendingFriendCode(code: string): void {
  save(FRIEND_KEY, code);
}

/** The Friend code saved before sign-in, if any. */
export function readPendingFriendCode(): string | null {
  return read(FRIEND_KEY);
}

/** Forgets the saved Friend code once it has been handed to the friend-link page. */
export function clearPendingFriendCode(): void {
  clear(FRIEND_KEY);
}

/**
 * Remembers that a sign-in button was just pressed, so the round trip back to
 * the site origin goes on to the Rooms list instead of the landing page (spec
 * 45, Decision 2).
 */
export function markSigningIn(): void {
  save(SIGN_IN_KEY, '1');
}

/** Whether a sign-in was started on this tab and not yet followed through. */
export function readSigningIn(): boolean {
  return read(SIGN_IN_KEY) !== null;
}

/** Forgets the started sign-in once the user is signed in. */
export function clearSigningIn(): void {
  clear(SIGN_IN_KEY);
}
