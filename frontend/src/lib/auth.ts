/**
 * The sign-in session, kept by the backend (ticket 73 step 3).
 *
 * The backend runs the OAuth round trip itself and leaves an HttpOnly session
 * cookie on its own origin, which this page cannot read. `POST /auth/refresh`
 * trades that cookie for a short access token, kept in memory only and sent
 * as `Bearer` by `apiClient`. A reload or a new tab asks again; a token about
 * to expire is renewed ahead of time.
 */

/** The signed-in user, as `POST /auth/refresh` describes them. */
export interface AuthUser {
  id: string;
  email: string | null;
  provider: string;
}

/** What `useSession` hands out: the access token and whose it is. */
export interface AuthSession {
  access_token: string;
  user: AuthUser;
}

interface RefreshResponse {
  access_token: string;
  expires_in: number;
  user: AuthUser;
}

/** How long before expiry the token is renewed, so no request carries a stale one. */
const RENEW_MARGIN_MS = 60_000;

let current: AuthSession | null = null;
let expiresAt = 0;
let loaded = false;
let pending: Promise<AuthSession | null> | null = null;
let renewTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<(session: AuthSession | null) => void>();

function apiUrl(path: string): string {
  return `${import.meta.env.VITE_API_BASE_URL}${path}`;
}

function publish(session: AuthSession | null, expiresInSeconds = 0) {
  current = session;
  loaded = true;
  clearTimeout(renewTimer);
  renewTimer = undefined;
  if (session) {
    expiresAt = Date.now() + expiresInSeconds * 1000;
    const delay = Math.max(expiresAt - Date.now() - RENEW_MARGIN_MS, 0);
    renewTimer = setTimeout(() => void refreshSession(), delay);
  } else {
    expiresAt = 0;
  }
  listeners.forEach((listener) => listener(session));
}

async function askBackend(): Promise<AuthSession | null> {
  let response: Response;
  try {
    response = await fetch(apiUrl('/auth/refresh'), { method: 'POST', credentials: 'include' });
  } catch {
    // Offline or the API is down: keep what we have, the next call tries again.
    return current;
  }
  if (!response.ok) {
    publish(null);
    return null;
  }
  const body = (await response.json()) as RefreshResponse;
  const session = { access_token: body.access_token, user: body.user };
  publish(session, body.expires_in);
  return session;
}

/**
 * Asks the backend for a fresh access token. Calls made while one is under
 * way share it, so a burst of requests rotates the session cookie once.
 */
export function refreshSession(): Promise<AuthSession | null> {
  pending ??= askBackend().finally(() => {
    pending = null;
  });
  return pending;
}

/** The current session, asking the backend first when none is known yet or it is about to expire. */
export async function getSession(): Promise<AuthSession | null> {
  if (loaded && (!current || Date.now() < expiresAt - RENEW_MARGIN_MS)) {
    return current;
  }
  return refreshSession();
}

/** Calls `listener` whenever the session changes; returns the unsubscribe. */
export function onSessionChange(listener: (session: AuthSession | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Leaves for the provider's sign-in page; the backend brings the browser back to this origin. */
export function signIn(provider: string): void {
  const returnTo = encodeURIComponent(window.location.origin);
  window.location.assign(apiUrl(`/auth/${provider}/start?return_to=${returnTo}`));
}

/** Ends the session on the backend and forgets it here. */
export async function signOut(): Promise<void> {
  const response = await fetch(apiUrl('/auth/logout'), { method: 'POST', credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Sign-out failed (${response.status})`);
  }
  publish(null);
}

/** Forgets the session on this page only, e.g. once the account itself is gone. */
export function forgetSession(): void {
  publish(null);
}

/** Back to "nothing known yet"; for tests. */
export function resetAuthForTests(): void {
  clearTimeout(renewTimer);
  renewTimer = undefined;
  current = null;
  expiresAt = 0;
  loaded = false;
  pending = null;
  listeners.clear();
}
