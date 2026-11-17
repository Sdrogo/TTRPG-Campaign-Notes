import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetSession,
  getSession,
  onSessionChange,
  refreshSession,
  resetAuthForTests,
  signIn,
  signOut,
} from '../../lib/auth';

const USER = { id: 'user-1', email: 'io@example.com', provider: 'google' };

function answer(status: number, body: unknown = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status });
}

function refreshAnswer(token: string, expiresIn = 900) {
  return answer(200, { access_token: token, expires_in: expiresIn, user: USER });
}

function stubFetch(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetAuthForTests();
});

afterEach(() => {
  resetAuthForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('getSession', () => {
  it('trades the session cookie for an access token', async () => {
    const fetchMock = stubFetch(refreshAnswer('token-1'));

    await expect(getSession()).resolves.toEqual({ access_token: 'token-1', user: USER });

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('reuses a token that is still fresh', async () => {
    const fetchMock = stubFetch(refreshAnswer('token-1'));
    await getSession();

    await expect(getSession()).resolves.toMatchObject({ access_token: 'token-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Nobody signed in: the answer is known, no need to ask on every request.
  it('remembers that nobody is signed in', async () => {
    const fetchMock = stubFetch(answer(401, { detail: 'Signed out' }));

    await expect(getSession()).resolves.toBeNull();
    await expect(getSession()).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renews a token about to expire before handing it out', async () => {
    const fetchMock = stubFetch(refreshAnswer('short', 30), refreshAnswer('renewed'));
    await getSession();

    await expect(getSession()).resolves.toMatchObject({ access_token: 'renewed' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Offline for a moment: keep the session rather than signing the user out.
  it('keeps the current session when the backend cannot be reached', async () => {
    stubFetch(refreshAnswer('short', 30), new TypeError('Failed to fetch'));
    await getSession();

    await expect(getSession()).resolves.toMatchObject({ access_token: 'short' });
  });
});

describe('refreshSession', () => {
  // The cookie rotates on each use: a burst of calls must rotate it once.
  it('shares one request among calls made at the same time', async () => {
    const fetchMock = stubFetch(refreshAnswer('token-1'));

    const [first, second] = await Promise.all([refreshSession(), refreshSession()]);

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renews on its own a minute before the token expires', async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(refreshAnswer('token-1', 900), refreshAnswer('token-2'));
    const listener = vi.fn();
    onSessionChange(listener);
    await refreshSession();

    await vi.advanceTimersByTimeAsync(839_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ access_token: 'token-2', user: USER });
  });
});

describe('onSessionChange', () => {
  it('tells listeners about each change until they unsubscribe', async () => {
    stubFetch(refreshAnswer('token-1'), refreshAnswer('token-2'));
    const listener = vi.fn();
    const unsubscribe = onSessionChange(listener);

    await refreshSession();
    unsubscribe();
    await refreshSession();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('signIn', () => {
  it('leaves for the backend, asking to come back to this origin', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, origin: 'https://exlibris.world', assign });

    signIn('discord');

    expect(assign).toHaveBeenCalledWith(
      'http://api.test/auth/discord/start?return_to=https%3A%2F%2Fexlibris.world',
    );
  });
});

describe('signOut', () => {
  it('ends the session on the backend and forgets it here', async () => {
    const fetchMock = stubFetch(refreshAnswer('token-1'), answer(204));
    await getSession();
    const listener = vi.fn();
    onSessionChange(listener);

    await signOut();

    expect(fetchMock).toHaveBeenLastCalledWith('http://api.test/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    expect(listener).toHaveBeenCalledWith(null);
    await expect(getSession()).resolves.toBeNull();
  });

  it('throws and keeps the session when the backend refuses', async () => {
    stubFetch(refreshAnswer('token-1'), answer(403, { detail: 'Bad origin' }));
    await getSession();

    await expect(signOut()).rejects.toThrow('Sign-out failed (403)');
    await expect(getSession()).resolves.toMatchObject({ access_token: 'token-1' });
  });
});

describe('forgetSession', () => {
  it('drops the session on this page without asking the backend', async () => {
    const fetchMock = stubFetch(refreshAnswer('token-1'));
    await getSession();

    forgetSession();

    await expect(getSession()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
