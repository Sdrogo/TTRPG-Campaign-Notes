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
    subtitle: null,
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
    relational_link: false,
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
    subtitle: null,
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
    matched_by_name: false,
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
    maps: [],
    sections: [],
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

/** A map as `GET /rooms/{id}/maps` lists it (spec 28). */
export function rawMap(overrides: Record<string, unknown> = {}) {
  return {
    id: 'map-1',
    room_id: 'room-1',
    name: 'La Corte',
    description: 'Chi serve chi',
    kind: 'free',
    plane_width: null,
    plane_height: null,
    visibility: 'room',
    selective_user_ids: [],
    created_by: 'user-1',
    created_at: '2026-10-12T10:00:00Z',
    updated_at: '2026-10-12T10:00:00Z',
    document_count: 2,
    players_can_edit: false,
    revision: 3,
    can_edit: true,
    can_manage: true,
    ...overrides,
  };
}

/** A Document card of a map, as the API sends it. */
export function rawMapCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'card-1',
    document_id: 'doc-1',
    text: null,
    group_id: null,
    caption: null,
    image_id: null,
    size: 'normal',
    master_only: false,
    color: 'default',
    struck: false,
    x: 0,
    y: 0,
    document: { id: 'doc-1', name: 'Mira', subtitle: 'La Idol', image: null, tag_ids: [] },
    ...overrides,
  };
}

/** A map with its board, as `GET /rooms/{id}/maps/{map_id}` sends it. */
export function rawMapDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...rawMap(),
    groups: [
      { id: 'group-1', title: 'Avversari', color: 'red', struck: false, x: 300, y: 0, width: 300, height: 200 },
    ],
    cards: [
      rawMapCard(),
      rawMapCard({
        id: 'card-2',
        document_id: 'doc-2',
        group_id: 'group-1',
        x: 20,
        y: 40,
        document: { id: 'doc-2', name: 'Thorn', subtitle: null, image: rawImage(), tag_ids: ['npc'] },
      }),
      rawMapCard({ id: 'card-3', document_id: null, text: 'La notte del fuoco', document: null }),
    ],
    arrows: [
      {
        id: 'arrow-1',
        from_end: { card_id: 'card-1', group_id: null },
        to_end: { card_id: 'card-2', group_id: null },
        direction: 'both',
        label: 'alleata',
        reverse_label: 'alleato',
        label_position: null,
        reverse_label_position: null,
        label_offset: null,
        reverse_label_offset: null,
        bend: null,
        color: 'green',
        master_only: false,
      },
    ],
    ...overrides,
  };
}

/** A Document's mention map, as `GET .../documents/{id}/mention-map` sends it (spec 36). */
export function rawMentionMap(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mention-map-1',
    document_id: 'doc-1',
    depth: 0,
    created_by: 'user-1',
    updated_at: '2026-10-14T10:00:00Z',
    can_manage: true,
    revision: 1,
    cards: [
      rawMapCard({ color: 'gold' }),
      rawMapCard({
        id: 'card-2',
        document_id: 'doc-2',
        x: 400,
        document: { id: 'doc-2', name: 'Thorn', subtitle: null, image: null, tag_ids: [] },
      }),
    ],
    arrows: [
      {
        id: 'arrow-1',
        from_end: { card_id: 'card-1', group_id: null },
        to_end: { card_id: 'card-2', group_id: null },
        direction: 'forward',
        label: null,
        reverse_label: null,
        label_position: null,
        reverse_label_position: null,
        label_offset: null,
        reverse_label_offset: null,
        bend: null,
        color: 'default',
        master_only: false,
      },
    ],
    documents_left_out: 0,
    ...overrides,
  };
}

/** A Document's look on a geographic map's area or pin, as the API sends it (spec 38). */
function rawPlaceDocument(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return { id, name, subtitle: null, image: null, tag_ids: [], ...overrides };
}

/**
 * A geographic map with its content, as `GET .../maps/{id}/geo` sends it
 * (spec 38): a Document's area and a plain dashed one, a Document's pin and
 * a plain one, and a link between the two pins.
 */
export function rawGeoMapDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...rawMap({ name: 'Shibuya di notte', kind: 'geographic', plane_width: 2000, plane_height: 1400 }),
    background_url: null,
    areas: [
      {
        id: 'area-1',
        document_id: 'doc-1',
        name: null,
        subtitle: null,
        note: null,
        points: [
          [100, 100],
          [500, 100],
          [500, 400],
          [100, 400],
        ],
        color: 'blue',
        dashed: false,
        filled: true,
        master_only: false,
        document: rawPlaceDocument('doc-1', 'Incrocio', { subtitle: 'Il cuore', tag_ids: ['tag-1'] }),
      },
      {
        id: 'area-2',
        document_id: null,
        name: 'Il bosco',
        subtitle: 'Sacro',
        note: 'Nessuno lo controlla.',
        points: [
          [1000, 100],
          [1400, 100],
          [1200, 500],
        ],
        color: 'emerald',
        dashed: true,
        filled: false,
        master_only: false,
        document: null,
      },
    ],
    pins: [
      {
        id: 'pin-1',
        document_id: 'doc-2',
        name: null,
        note: null,
        x: 300,
        y: 250,
        label_side: 'left',
        color: 'gold',
        master_only: false,
        document: rawPlaceDocument('doc-2', 'Shibuya Sky'),
      },
      {
        id: 'pin-2',
        document_id: null,
        name: 'Shibuya 109',
        note: 'Il cilindro argentato.',
        x: 800,
        y: 700,
        label_side: 'above',
        color: 'default',
        master_only: true,
        document: null,
      },
    ],
    links: [
      {
        id: 'link-1',
        from_end: { area_id: null, pin_id: 'pin-1' },
        to_end: { area_id: null, pin_id: 'pin-2' },
        direction: 'forward',
        label: 'la finestra',
        reverse_label: null,
        bend: -80,
        label_position: null,
        reverse_label_position: null,
        label_offset: null,
        reverse_label_offset: null,
        color: 'champagne',
        master_only: false,
      },
    ],
    ...overrides,
  };
}

/** A post-it as `GET /rooms/{id}/session-zero` sends it (spec 46): published, signed, by user-1. */
export function rawPostIt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'card-1',
    column_id: 'col-1',
    group_id: null,
    position: 0,
    body: 'Niente ragni',
    author_id: 'user-1',
    anonymous: false,
    mine: true,
    draft: false,
    from_retro: false,
    published_at: '2026-10-27T10:00:00Z',
    created_at: '2026-10-27T09:59:00Z',
    updated_at: '2026-10-27T10:00:00Z',
    reactions: [],
    can_edit: true,
    can_delete: true,
    can_publish: false,
    can_promote: false,
    can_move: false,
    can_react: true,
    can_group: false,
    can_place: false,
    ...overrides,
  };
}

/** A Session 0 column; `kind` set makes it a Lines & Veils one. */
export function rawPostItColumn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'col-1',
    kind: null,
    title: 'Lo vogliamo al tavolo',
    color: 'green',
    groups: [],
    cards: [],
    ...overrides,
  };
}

/**
 * A started Session 0 seen by a Player: round 1 open, two Retro columns (the
 * first with one post-it), the three Lines & Veils columns, no timer.
 */
/**
 * A Session 0 as the backend answers it. A `retro` override is the columns
 * of the chain's first step, a Retro one (spec 47), followed by Lines &
 * Veils; `modules` replaces the whole chain.
 */
export function rawSessionZero(overrides: Record<string, unknown> = {}) {
  const {
    retro = [
      rawPostItColumn({ cards: [rawPostIt()] }),
      rawPostItColumn({ id: 'col-2', title: 'Da evitare', color: 'red' }),
    ],
    ...rest
  } = overrides;
  const started = rest.started ?? true;
  return {
    started: true,
    revision: 3,
    can_manage: false,
    rounds: [{ id: 'round-1', number: 1, title: null, started_at: '2026-10-27T09:00:00Z', closed_at: null }],
    round_id: 'round-1',
    modules: started
      ? [
          { id: 'module-retro', kind: 'retro', position: 0, columns: retro },
          { id: 'module-lv', kind: 'lines_veils', position: 1, columns: [] },
        ]
      : [],
    current_module_id: started ? 'module-retro' : null,
    hidden_modules: 0,
    lines_veils: [
      rawPostItColumn({ id: 'lv-must', kind: 'must', title: 'must', color: 'green' }),
      rawPostItColumn({ id: 'lv-veils', kind: 'veils', title: 'veils', color: 'gold' }),
      rawPostItColumn({ id: 'lv-lines', kind: 'lines', title: 'lines', color: 'red' }),
    ],
    timer: null,
    ...rest,
  };
}

/** A landing block (spec 55) on the wire: a Documents block on `tag-1` unless overridden. */
export function rawBlock(overrides: Record<string, unknown> = {}) {
  return {
    id: 'block-1',
    kind: 'documents',
    position: 0,
    heading: null,
    tag_ids: ['tag-1'],
    groups: [],
    map_kind: null,
    features: [],
    ...overrides,
  };
}

/** A landing Section (spec 55) on the wire: a custom Section the Master edits unless overridden. */
export function rawSection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'section-1',
    kind: 'custom',
    position: 3,
    title: 'Tokyo',
    description: '',
    image_url: null,
    blocks: [],
    can_edit: true,
    ...overrides,
  };
}

/** The three page cards a Room starts with, then `extra`. */
export function rawSections(extra: Record<string, unknown>[] = [], overrides: Record<string, unknown> = {}) {
  return [
    rawSection({ id: 'page-documents', kind: 'page_documents', position: 0, title: null, ...overrides }),
    rawSection({ id: 'page-maps', kind: 'page_maps', position: 1, title: null, ...overrides }),
    rawSection({ id: 'page-session-zero', kind: 'page_session_zero', position: 2, title: null, ...overrides }),
    ...extra,
  ];
}

/** A poll on the wire (spec 53), open with one choice voted. */
export function rawPoll(overrides: Record<string, unknown> = {}) {
  return {
    id: 'poll-1',
    body: 'Quale sistema?',
    hint: null,
    max_choices: 1,
    master_votes: false,
    voters_visible: 'master',
    results: 'live',
    revealed: true,
    closed: false,
    has_votes: true,
    options: [
      { id: 'opt-1', body: 'D&D', description: null, count: 1, voters: null, winner: false },
      { id: 'opt-2', body: 'PbtA', description: null, count: 0, voters: null, winner: false },
    ],
    my_option_ids: [],
    voter_count: 1,
    electorate: 3,
    not_voted: null,
    tally_visible: true,
    can_vote: true,
    ...overrides,
  };
}

/** A Questions step on the wire (spec 47), with one question. */
export function rawQuestionsStep(overrides: Record<string, unknown> = {}) {
  return {
    tag_id: null,
    answers_revealed: false,
    players_bypass_creation_rule: false,
    questions: [{ id: 'q-1', position: 0, body: 'Nome?', hint: null, target: 'name', tag_id: null }],
    answers: [],
    documents: [],
    can_create: false,
    creatable: 0,
    ...overrides,
  };
}

/** A DDI step on the wire (spec 47), on `doc-1` with no acceptance. */
export function rawDdiStep(overrides: Record<string, unknown> = {}) {
  return { document_id: 'doc-1', document_hidden: false, changed_at: null, acceptances: [], can_accept: true, ...overrides };
}

/**
 * `GET .../session-zero/overview` (spec 55): one open session with a Retro
 * step (two post-its), a Questions, a DDI and a Poll step; Lines & Veils counts.
 */
export function rawSessionZeroOverview(overrides: Record<string, unknown> = {}) {
  return {
    started: true,
    rounds: [
      {
        id: 'round-1',
        number: 1,
        title: null,
        started_at: '2026-10-27T09:00:00Z',
        closed_at: null,
        steps: [
          { id: 'step-retro', kind: 'retro', position: 0, cards: 2 },
          { id: 'step-questions', kind: 'questions', position: 1, cards: 0, questions: rawQuestionsStep() },
          { id: 'step-ddi', kind: 'ddi', position: 2, cards: 0, ddi: rawDdiStep() },
          { id: 'step-poll', kind: 'poll', position: 3, cards: 0, polls: [rawPoll()] },
        ],
      },
    ],
    lines_veils: { must: 1, veils: 2 },
    ...overrides,
  };
}
