// "View as" (spec 22b, FR-V3): the member whose view the Master previews,
// sent by `apiFetch` as the `X-View-As` header while it is set. Module state,
// like the UI language, because `apiFetch` runs outside React; only
// `ViewAsProvider` sets it.

/** The header the backend reads (`app/auth/dependencies.py`). */
export const VIEW_AS_HEADER = 'X-View-As';

/** The URL search parameter that holds the member's user id. */
export const VIEW_AS_PARAM = 'as';

let viewAsUserId: string | null = null;

/** The member being previewed, or null for the signed-in user's own view. */
export function viewAsUser(): string | null {
  return viewAsUserId;
}

/** Starts or ends the preview for every later request. */
export function setViewAsUser(userId: string | null): void {
  viewAsUserId = userId;
}
