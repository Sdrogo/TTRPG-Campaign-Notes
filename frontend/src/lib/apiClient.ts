import { currentLanguage } from '../i18n';
import { supabase } from './supabaseClient';
import { VIEW_AS_HEADER, viewAsUser } from './viewAs';

/**
 * A non-2xx response from the backend. `message` is its `detail` when the body
 * is FastAPI's JSON error, else the raw body.
 */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ApiFetchInit extends Omit<RequestInit, 'body'> {
  json?: unknown;
  // Multipart upload; the browser sets its own Content-Type with the boundary.
  formData?: FormData;
  // Leaves out `X-View-As` while the Master previews a member (spec 22b). For
  // the Room PDF's own job routes (spec 23b): a write refuses that header, and a
  // read with it would answer as the member, whose jobs the Master doesn't own.
  ignoreViewAs?: boolean;
}

/**
 * Sends a request to the backend at `VITE_API_BASE_URL` with the current
 * Supabase access token and returns the response once it is known to be 2xx;
 * throws `ApiError` otherwise.
 *
 * Sends the UI's current language as `Accept-Language`, so the backend's
 * error text matches the flag selector rather than the browser's locale.
 * While the Master previews a Room as a member (spec 22b), sends
 * `X-View-As` too, unless `ignoreViewAs` is set.
 */
async function request(path: string, init: ApiFetchInit): Promise<Response> {
  const { json, formData, ignoreViewAs, ...rest } = init;
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(rest.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  headers.set('Accept-Language', currentLanguage());
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const viewAs = ignoreViewAs ? null : viewAsUser();
  if (viewAs) {
    headers.set(VIEW_AS_HEADER, viewAs);
  }
  if (session) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }

  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}${path}`, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : formData,
  });

  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { detail?: string };
      if (parsed.detail) {
        message = parsed.detail;
      }
    } catch {
      // Not JSON (e.g. a plain-text 500) - fall back to the raw body.
    }
    throw new ApiError(response.status, message);
  }
  return response;
}

/**
 * Calls the backend and reads the JSON answer. Pass `json` for a JSON body or
 * `formData` for an upload. Throws `ApiError` on any non-2xx; a 204 resolves
 * to `undefined`.
 */
export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const response = await request(path, init);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * Calls the backend for a file (the Room export, spec 23) and returns its
 * bytes. Same headers and errors as `apiFetch`, so a preview as a member
 * (spec 22b) downloads what that member sees.
 */
export async function apiDownload(path: string): Promise<Blob> {
  const response = await request(path, { headers: { Accept: '*/*' } });
  return response.blob();
}
