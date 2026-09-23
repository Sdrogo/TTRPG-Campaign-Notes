import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './apiClient';
import { supabase } from './supabaseClient';

vi.mock('./supabaseClient', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

const getSession = vi.mocked(supabase.auth.getSession);

function signedIn(accessToken = 'jwt-token') {
  getSession.mockResolvedValue({
    data: { session: { access_token: accessToken } },
  } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
}

function signedOut() {
  getSession.mockResolvedValue({ data: { session: null } } as unknown as Awaited<
    ReturnType<typeof supabase.auth.getSession>
  >);
}

// A `Response` body can only be read once, so each call gets a fresh one -
// otherwise a test that fetches twice fails on "Body has already been read".
function respondWith(body: string, init: ResponseInit = {}) {
  const status = init.status ?? 200;
  const fetchMock = vi.fn(() =>
    // 204 is the one status the Response constructor refuses a body for.
    Promise.resolve(new Response(status === 204 ? null : body, { ...init, status })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// The single argument every assertion about headers/body/URL reads.
function callInit(fetchMock: ReturnType<typeof respondWith>) {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init, headers: init.headers as Headers };
}

beforeEach(() => {
  signedIn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('prefixes the path with the configured API base URL', async () => {
    const fetchMock = respondWith('{}');

    await apiFetch('/rooms');

    expect(callInit(fetchMock).url).toBe('http://api.test/rooms');
  });

  it('parses and returns the JSON body', async () => {
    respondWith(JSON.stringify([{ id: 'room-1' }]));

    await expect(apiFetch<{ id: string }[]>('/rooms')).resolves.toEqual([{ id: 'room-1' }]);
  });

  it('always asks for JSON back', async () => {
    const fetchMock = respondWith('{}');

    await apiFetch('/rooms');

    expect(callInit(fetchMock).headers.get('Accept')).toBe('application/json');
  });
});

describe('authorization', () => {
  it('attaches the session token as a Bearer header', async () => {
    signedIn('a-real-looking-jwt');
    const fetchMock = respondWith('{}');

    await apiFetch('/rooms');

    expect(callInit(fetchMock).headers.get('Authorization')).toBe('Bearer a-real-looking-jwt');
  });

  // The backend answers 401; sending no header at all is the honest request.
  it('sends no Authorization header when there is no session', async () => {
    signedOut();
    const fetchMock = respondWith('{}');

    await apiFetch('/rooms');

    expect(callInit(fetchMock).headers.has('Authorization')).toBe(false);
  });

  it('reads the session on every call, so a refreshed token is picked up', async () => {
    respondWith('{}');

    signedIn('first-token');
    await apiFetch('/rooms');
    signedIn('second-token');
    await apiFetch('/rooms');

    const fetchMock = vi.mocked(fetch);
    const second = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
    expect(second.get('Authorization')).toBe('Bearer second-token');
  });
});

describe('request bodies', () => {
  it('serializes `json` and sets the JSON content type', async () => {
    const fetchMock = respondWith('{}');

    await apiFetch('/rooms', { method: 'POST', json: { name: 'Sala' } });

    const { init, headers } = callInit(fetchMock);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init.body).toBe('{"name":"Sala"}');
  });

  // The browser has to set multipart's Content-Type itself: it carries the
  // boundary, which we don't know here.
  it('passes FormData through without a Content-Type', async () => {
    const formData = new FormData();
    formData.append('file', new File(['bytes'], 'map.png'));
    const fetchMock = respondWith('{}');

    await apiFetch('/documents/1/images', { method: 'POST', formData });

    const { init, headers } = callInit(fetchMock);
    expect(headers.has('Content-Type')).toBe(false);
    expect(init.body).toBe(formData);
  });

  it('sends no body when neither is given', async () => {
    const fetchMock = respondWith('{}');

    await apiFetch('/rooms/1/members/2', { method: 'DELETE' });

    expect(callInit(fetchMock).init.body).toBeUndefined();
  });

  it('serializes an explicit null json body rather than skipping it', async () => {
    const fetchMock = respondWith('{}');

    await apiFetch('/rooms', { method: 'POST', json: null });

    const { init, headers } = callInit(fetchMock);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init.body).toBe('null');
  });

  it('keeps caller-supplied headers', async () => {
    const fetchMock = respondWith('{}');

    await apiFetch('/rooms', { headers: { 'X-Trace': 'abc' } });

    expect(callInit(fetchMock).headers.get('X-Trace')).toBe('abc');
  });
});

describe('error handling', () => {
  it('throws an ApiError carrying the status code', async () => {
    respondWith('{}', { status: 403 });

    await expect(apiFetch('/rooms/1')).rejects.toBeInstanceOf(ApiError);
    await expect(apiFetch('/rooms/1')).rejects.toMatchObject({ status: 403 });
  });

  // FastAPI puts the human-readable reason in `detail`; that's what the UI shows.
  it("uses FastAPI's `detail` field as the message", async () => {
    respondWith(JSON.stringify({ detail: 'Not a member of this room' }), { status: 403 });

    await expect(apiFetch('/rooms/1')).rejects.toThrow('Not a member of this room');
  });

  it('falls back to the raw body when it is not JSON', async () => {
    respondWith('Internal Server Error', { status: 500 });

    await expect(apiFetch('/rooms/1')).rejects.toThrow('Internal Server Error');
  });

  it('falls back to the raw body when JSON has no `detail`', async () => {
    respondWith(JSON.stringify({ error: 'nope' }), { status: 422 });

    await expect(apiFetch('/rooms/1')).rejects.toThrow('{"error":"nope"}');
  });

  it('does not treat a 204 as an error', async () => {
    respondWith('', { status: 204 });

    await expect(apiFetch('/rooms/1/members/2', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('ApiError', () => {
  it('is a real Error subclass, so `instanceof Error` narrowing works', () => {
    const error = new ApiError(404, 'Room not found');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Room not found');
    expect(error.status).toBe(404);
  });
});
