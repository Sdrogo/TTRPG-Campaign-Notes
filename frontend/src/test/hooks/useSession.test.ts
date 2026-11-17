import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthSession, getSession, onSessionChange } from '../../lib/auth';
import { useSession } from '../../hooks/useSession';
import { DEMO_SESSION, setDemoMode } from '../../lib/demo/demoMode';

vi.mock('../../lib/auth', () => ({ getSession: vi.fn(), onSessionChange: vi.fn() }));

const unsubscribe = vi.fn();
// Captured so a test can push a change the way `lib/auth` would.
let emit: (session: AuthSession | null) => void = () => {};

function session(id: string): AuthSession {
  return { access_token: id, user: { id, email: null, provider: 'google' } };
}

beforeEach(() => {
  unsubscribe.mockReset();
  vi.mocked(onSessionChange).mockImplementation((listener) => {
    emit = listener;
    return unsubscribe;
  });
});

describe('useSession', () => {
  it('starts out loading with no session', () => {
    vi.mocked(getSession).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSession());

    expect(result.current.loading).toBe(true);
    expect(result.current.session).toBeNull();
  });

  it('settles with the restored session', async () => {
    vi.mocked(getSession).mockResolvedValue(session('restored'));

    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session?.access_token).toBe('restored');
  });

  // Nobody signed in: still "done loading", just with no session. The app
  // routes to the login page off `loading === false`, so this has to settle.
  it('settles with null when nobody is signed in', async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('picks up a renewed token', async () => {
    vi.mocked(getSession).mockResolvedValue(session('old'));
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => emit(session('fresh')));

    expect(result.current.session?.access_token).toBe('fresh');
  });

  it('drops the session on sign-out', async () => {
    vi.mocked(getSession).mockResolvedValue(session('old'));
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.session).not.toBeNull());

    act(() => emit(null));

    expect(result.current.session).toBeNull();
  });

  // Leaking the listener would keep updating an unmounted component and, in
  // StrictMode, stack a second subscription on every remount.
  it('unsubscribes on unmount and ignores a late answer', async () => {
    let answer: (value: AuthSession | null) => void = () => {};
    vi.mocked(getSession).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { unmount, result } = renderHook(() => useSession());

    unmount();
    emit(session('late'));
    await act(async () => answer(session('late')));

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.session).toBeNull();
  });

  it('is the sample Room Master while the Demo is on', () => {
    vi.mocked(getSession).mockReturnValue(new Promise(() => {}));
    setDemoMode(true);

    const { result } = renderHook(() => useSession());

    expect(result.current).toEqual({ session: DEMO_SESSION, loading: false });
    setDemoMode(false);
  });
});
