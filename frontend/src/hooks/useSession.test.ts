import { act, renderHook, waitFor } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../lib/supabaseClient';
import { useSession } from './useSession';

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

const getSession = vi.mocked(supabase.auth.getSession);
const onAuthStateChange = vi.mocked(supabase.auth.onAuthStateChange);

const unsubscribe = vi.fn();
// Captured so a test can push an auth event the way Supabase would.
let emit: (event: string, session: Session | null) => void = () => {};

function session(id: string) {
  return { access_token: id, user: { id } } as unknown as Session;
}

beforeEach(() => {
  unsubscribe.mockReset();
  onAuthStateChange.mockImplementation((callback) => {
    emit = callback as unknown as typeof emit;
    return { data: { subscription: { unsubscribe } } } as unknown as ReturnType<
      typeof supabase.auth.onAuthStateChange
    >;
  });
});

describe('useSession', () => {
  it('starts out loading with no session', () => {
    getSession.mockReturnValue(new Promise(() => {}) as ReturnType<typeof supabase.auth.getSession>);

    const { result } = renderHook(() => useSession());

    expect(result.current.loading).toBe(true);
    expect(result.current.session).toBeNull();
  });

  it('settles with the restored session', async () => {
    getSession.mockResolvedValue({ data: { session: session('restored') } } as Awaited<
      ReturnType<typeof supabase.auth.getSession>
    >);

    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session?.access_token).toBe('restored');
  });

  // Nobody signed in: still "done loading", just with no session. The app
  // routes to the login page off `loading === false`, so this has to settle.
  it('settles with null when there is no stored session', async () => {
    getSession.mockResolvedValue({ data: { session: null } } as Awaited<
      ReturnType<typeof supabase.auth.getSession>
    >);

    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('picks up a later sign-in from the auth listener', async () => {
    getSession.mockResolvedValue({ data: { session: null } } as Awaited<
      ReturnType<typeof supabase.auth.getSession>
    >);
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => emit('SIGNED_IN', session('fresh')));

    expect(result.current.session?.access_token).toBe('fresh');
  });

  it('drops the session on sign-out', async () => {
    getSession.mockResolvedValue({ data: { session: session('old') } } as Awaited<
      ReturnType<typeof supabase.auth.getSession>
    >);
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.session).not.toBeNull());

    act(() => emit('SIGNED_OUT', null));

    expect(result.current.session).toBeNull();
  });

  // Leaking the listener would keep updating an unmounted component and, in
  // StrictMode, stack a second subscription on every remount.
  it('unsubscribes on unmount', async () => {
    getSession.mockResolvedValue({ data: { session: null } } as Awaited<
      ReturnType<typeof supabase.auth.getSession>
    >);
    const { unmount, result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
