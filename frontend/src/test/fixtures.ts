// Raw API payloads, in the snake_case shape the backend actually sends.
// Hooks are the layer that converts these, so the fixtures must stay in wire
// form - building them in camelCase would test the mapping against itself.

export function rawRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: 'room-1',
    name: 'La Cripta',
    game_system: 'D&D 5e',
    status: 'active',
    players_can_create_documents: true,
    default_visibility: 'room',
    image_url: null,
    ...overrides,
  };
}

export function rawMyRoom(overrides: Record<string, unknown> = {}) {
  return { room: rawRoom(), role: 'master', is_admin: true, ...overrides };
}

export function rawImage(overrides: Record<string, unknown> = {}) {
  return { id: 'image-1', url: 'http://signed/image-1.webp', is_favorite: false, ...overrides };
}

export function rawDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    room_id: 'room-1',
    name: 'Il Cancello',
    description: 'Una porta di pietra.',
    visibility: 'room',
    images: [rawImage()],
    tag_ids: ['tag-1'],
    owner_ids: ['user-1'],
    selective_user_ids: [],
    played_by: null,
    ...overrides,
  };
}

/** `POST .../read`'s answer (spec 19b): a first visit unless overridden. */
export function rawDocumentRead(overrides: Record<string, unknown> = {}) {
  return {
    last_read_at: '2026-10-02T12:00:00Z',
    previous_read_at: null,
    revealed: { document: false, note_ids: [], comment_ids: [] },
    ...overrides,
  };
}

export function rawNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    document_id: 'doc-1',
    title: 'Porta segreta',
    description: 'Dietro la libreria.',
    visibility: 'room',
    selective_user_ids: [],
    position: 0,
    created_at: '2026-10-01T12:00:00Z',
    updated_at: '2026-10-01T12:00:00Z',
    can_edit: true,
    can_delete: true,
    ...overrides,
  };
}

export function rawDocumentFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    document_id: 'doc-1',
    name: 'Scheda di Aria.pdf',
    size_bytes: 2_516_582,
    content_type: 'application/pdf',
    uploaded_by: 'user-1',
    created_at: '2026-10-01T12:00:00Z',
    url: 'https://storage.example/file-1.pdf?token=t&download=Scheda',
    can_delete: true,
    ...overrides,
  };
}

export function rawComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'comment-1',
    document_id: 'doc-1',
    author_id: 'user-1',
    body: 'Ricordate il sigillo.',
    visibility: 'room',
    selective_user_ids: [],
    created_at: '2026-09-21T12:00:00Z',
    updated_at: '2026-09-21T12:00:00Z',
    deleted: false,
    images: [],
    can_edit: true,
    can_delete: true,
    as_character: null,
    parent_id: null,
    parent_hidden: false,
    reactions: [],
    pinned_at: null,
    resolved_at: null,
    resolved_by: null,
    can_pin: false,
    can_resolve: false,
    promoted_at: null,
    promoted_to: null,
    promoted_document_id: null,
    can_promote: false,
    ...overrides,
  };
}

export function rawCharacter(overrides: Record<string, unknown> = {}) {
  return {
    document_id: 'doc-2',
    name: 'Aria',
    image_url: 'http://signed/aria.webp',
    ...overrides,
  };
}

export function rawMember(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    role: 'player',
    is_admin: false,
    email: 'giocatore@example.com',
    display_name: 'Giocatore',
    pronouns: 'lui',
    bio: null,
    avatar_url: null,
    ...overrides,
  };
}

export function rawFriend(overrides: Record<string, unknown> = {}) {
  return {
    friendship_id: 'friendship-1',
    user_id: 'user-2',
    since: '2026-10-01T12:00:00Z',
    email: null,
    display_name: 'Altro',
    pronouns: null,
    bio: null,
    avatar_url: null,
    ...overrides,
  };
}

export function rawFriends(overrides: Record<string, unknown> = {}) {
  return { friends: [], incoming: [], outgoing: [], ...overrides };
}

export function rawDirectInvitation(overrides: Record<string, unknown> = {}) {
  return {
    code: 'DIRECT1',
    role: 'player',
    expires_at: '2026-10-09T12:00:00Z',
    room: rawRoom({ id: 'room-2', name: 'Barovia' }),
    invited_by: {
      user_id: 'user-2',
      email: null,
      display_name: 'Altro',
      pronouns: null,
      bio: null,
      avatar_url: null,
    },
    ...overrides,
  };
}

export function rawAccount(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    email: 'io@example.com',
    display_name: 'Io',
    pronouns: null,
    bio: null,
    avatar_url: null,
    ...overrides,
  };
}

// A Supabase session, as `useSession` hands it to a page. Only `user.id` and
// the access token are ever read, so the rest is left off.
export function fakeSession(userId = 'user-1') {
  return { access_token: `token-${userId}`, user: { id: userId } };
}

/** One of `GET /reveals/mine`'s entries (spec 22): a Document revealed to the user. */
export function rawMyReveal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reveal-1',
    room_id: 'room-1',
    kind: 'document',
    document_id: 'doc-1',
    note_id: null,
    comment_id: null,
    revealed_at: '2026-10-03T12:00:00Z',
    room_name: 'La Cripta',
    document_name: 'Il Cancello',
    note_title: null,
    ...overrides,
  };
}

/** One entry of a Room's visibility history (spec 22): a Document revealed to the Room. */
export function rawHistoryEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    created_at: '2026-10-03T12:00:00Z',
    actor_id: 'user-1',
    kind: 'document',
    is_reveal: true,
    state: 'visible',
    from_visibility: 'master',
    to_visibility: 'room',
    document_id: 'doc-1',
    document_name: 'Il Cancello',
    note_id: null,
    note_title: null,
    comment_id: null,
    selective_user_ids: [],
    recipient_ids: ['user-2'],
    ...overrides,
  };
}

/** A Room PDF job as `GET .../exports` sends it (spec 23b): queued unless overridden. */
export function rawPdfJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    status: 'queued',
    style: 'gothic',
    page_size: 'A4',
    created_at: '2026-10-05T12:00:00Z',
    finished_at: null,
    expires_at: null,
    download_url: null,
    ...overrides,
  };
}

/** A revision in the history list, as the backend sends it (spec 24b). */
export function rawVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    title: 'Il Cancello',
    edited_by: 'user-1',
    created_at: '2026-10-05T12:00:00Z',
    updated_at: '2026-10-05T12:00:00Z',
    words_added: null,
    words_removed: null,
    notes_added: null,
    notes_removed: null,
    ...overrides,
  };
}

/** A revision in full, as the backend sends it: the list entry plus its texts. */
export function rawVersionDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...rawVersion(),
    description: 'Un cancello.',
    notes: [],
    ...overrides,
  };
}

/** A Document found by the import preview, as `POST .../imports/preview` sends it (spec 27). */
export function rawImportPreviewDocument(overrides: Record<string, unknown> = {}) {
  return {
    key: '0:0',
    file_name: 'stanza.json',
    name: 'Il Cancello',
    notes_count: 2,
    images_count: 1,
    tag_names: ['PNG'],
    existing_document_id: null,
    can_replace: false,
    warnings: [],
    ...overrides,
  };
}

/** The import preview as the backend sends it: one new Document unless overridden. */
export function rawImportPreview(overrides: Record<string, unknown> = {}) {
  return {
    documents: [rawImportPreviewDocument()],
    matched_tags: ['PNG'],
    tags_to_create: [],
    unavailable_tags: [],
    ...overrides,
  };
}

/** An import job as `GET .../imports/{job}` sends it (spec 27): queued unless overridden. */
export function rawImportJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'import-1',
    status: 'queued',
    created_at: '2026-10-08T12:00:00Z',
    finished_at: null,
    result: null,
    ...overrides,
  };
}
