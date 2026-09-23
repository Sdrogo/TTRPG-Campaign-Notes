import { supabase } from './supabaseClient';

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
}

/**
 * Calls the backend at `VITE_API_BASE_URL` with the current Supabase access
 * token. Pass `json` for a JSON body or `formData` for an upload. Throws
 * `ApiError` on any non-2xx; a 204 resolves to `undefined`.
 */
export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { json, formData, ...rest } = init;
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(rest.headers);
  headers.set('Accept', 'application/json');
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
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

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
