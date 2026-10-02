// Cache keys shared by more than one hooks module, kept here so neither
// module imports the other just for a key.

/** The signed-in user's Friends and friend requests (`GET /friends`). */
export const FRIENDS_QUERY_KEY = ['friends'] as const;

/** The direct Room invitations waiting for the signed-in user (`GET /invitations/mine`). */
export const MY_INVITATIONS_QUERY_KEY = ['invitations', 'mine'] as const;
