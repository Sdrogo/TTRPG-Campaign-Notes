import type { Session } from '@supabase/supabase-js';

// The Demo (spec 45_2): the real pages over a sample Room kept in the
// browser. This module is the small, always-loaded part: the on/off flag that
// `apiClient` and `useSession` read synchronously. The sample data and the
// in-browser backend are a lazy chunk (`demoBackend.ts`), loaded by the first
// request made while the flag is on.

const DEMO_KEY = 'exlibris.demo';

/** The sample Room's id: its pages live at `/rooms/demo/...`. */
export const DEMO_ROOM_ID = 'demo';

/** The visitor, the sample Room's Master. */
export const DEMO_USER_ID = 'd3e0c0de-0000-4000-8000-000000000001';

/** The page the Demo opens on: the Room's landing (spec 55, spec 64 Decision 1). */
export const DEMO_START_PATH = `/rooms/${DEMO_ROOM_ID}`;

/** The Documents page of the sample Room: a Player's preview starts here (spec 22b works on Documents and maps only). */
export const DEMO_DOCUMENTS_PATH = `${DEMO_START_PATH}/documents`;

/** Whether the Demo is on in this tab. Storage errors read as off. */
export function isDemoMode(): boolean {
  try {
    return sessionStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Turns the Demo on or off for this tab: a refresh stays in it, a new tab
 * does not. Returns whether it is now on (false when storage is blocked).
 */
export function setDemoMode(on: boolean): boolean {
  try {
    if (on) sessionStorage.setItem(DEMO_KEY, '1');
    else sessionStorage.removeItem(DEMO_KEY);
  } catch {
    // Blocked storage: the Demo cannot start, the caller says so.
  }
  return isDemoMode();
}

/**
 * The session `useSession` hands out while the Demo is on: the sample Room's
 * Master. Only `user.id` is read by the pages; it is never sent anywhere.
 */
export const DEMO_SESSION = {
  access_token: 'demo',
  refresh_token: 'demo',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Number.MAX_SAFE_INTEGER,
  user: {
    id: DEMO_USER_ID,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-25T00:00:00Z',
  },
} as Session;

/** Leaves the Demo with a full page load, so no sample data stays in any cache. */
export function exitDemo(to: string) {
  setDemoMode(false);
  window.location.assign(to);
}
