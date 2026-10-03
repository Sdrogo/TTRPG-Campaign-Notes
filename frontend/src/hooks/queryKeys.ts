// Cache keys shared by more than one hooks module, kept here so neither
// module imports the other just for a key.

/** The signed-in user's Friends and friend requests (`GET /friends`). */
export const FRIENDS_QUERY_KEY = ['friends'] as const;

/** The direct Room invitations waiting for the signed-in user (`GET /invitations/mine`). */
export const MY_INVITATIONS_QUERY_KEY = ['invitations', 'mine'] as const;

/** Content revealed to the signed-in user they haven't opened yet (`GET /reveals/mine`). */
export const MY_REVEALS_QUERY_KEY = ['reveals', 'mine'] as const;

/**
 * What the latest visit to a Document opened among the content revealed to
 * the viewer (spec 22 Decision 3), written by `useDocumentVisit` and read by
 * the parts of the page that mark it "Revealed".
 */
export function revealVisitQueryKey(roomId: string, documentId: string) {
  return ['reveal-visit', roomId, documentId] as const;
}
