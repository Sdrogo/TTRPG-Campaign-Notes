import i18n, { currentLanguage } from '../../i18n';
import { DEMO_ROOM_ID } from './demoMode';
import { MASTER_ID, demoData, type DemoComment, type DemoData, type DemoDocument, type Visibility } from './demoData';

// The Demo's backend (spec 45_2): answers `apiClient`'s requests in the
// browser from the sample Room, in the API's wire shape, as the viewer may
// see it. The Demo is read-only (Decision 10): every write is refused with
// the localized "read-only" notice and nothing changes, except recording a
// Document visit, which the pages send on their own and which only answers.

/** When the sample Room was "last read": nothing in it shows as new. */
const READ_AT = '2026-10-25T00:00:00Z';
const UPDATED_AT = '2026-10-22T10:00:00Z';

const DOC_TOKEN = /(?:[#@])\[((?:\\.|[^\]\\])*)\]\((?:doc|tag|user):[0-9a-fA-F-]{36}\)/g;

/** Stored text as a reader sees it: mention tokens become their names. */
function plain(text: string): string {
  return text.replace(DOC_TOKEN, (_, name: string) => name.replace(/\\(.)/g, '$1'));
}

/**
 * Who a request answers to: the visitor (the sample Room's Master) or the
 * Player they preview, with the visibility rules that decide what they see.
 */
class Viewer {
  readonly id: string;
  readonly data: DemoData;

  constructor(id: string, data: DemoData) {
    this.id = id;
    this.data = data;
  }

  /** The Master sees everything (VR-01). */
  get isMaster(): boolean {
    return this.id === MASTER_ID;
  }

  /** The visibility rules of section 8 / VR-01..VR-07 for the sample data. */
  sees(visibility: Visibility, ownerIds: string[], selective: string[]): boolean {
    if (this.isMaster || visibility === 'room') return true;
    if (visibility === 'master') return false;
    if (ownerIds.includes(this.id)) return true;
    return visibility === 'selective' && selective.includes(this.id);
  }

  /** Whether the Document exists and its visibility lets the viewer see it. */
  seesDocument(doc: DemoDocument | undefined): doc is DemoDocument {
    return Boolean(doc && this.sees(doc.visibility, doc.owner_ids, doc.selective_user_ids));
  }

  /** The Document, or undefined when it is hidden from the viewer, as the API's 404. */
  document(id: string): DemoDocument | undefined {
    const doc = this.data.documents.find((d) => d.id === id);
    return this.seesDocument(doc) ? doc : undefined;
  }

  /** The Room's Documents the viewer sees. */
  documents(): DemoDocument[] {
    return this.data.documents.filter((doc) => this.seesDocument(doc));
  }

  /** The Document's Notes the viewer sees; a Note's author counts as its owner. */
  notes(documentId: string) {
    return this.data.notes.filter(
      (note) =>
        note.document_id === documentId &&
        this.sees(note.visibility, [note.author_id], note.selective_user_ids),
    );
  }

  /** Whether the viewer sees the Comment; its author counts as its owner. */
  seesComment(comment: DemoComment): boolean {
    return this.sees(comment.visibility, [comment.author_id], comment.selective_user_ids);
  }
}

/**
 * A Document in the API's wire shape (`RawDocument`): with `unread_count`
 * for the list (`GET .../documents`), with its Notes and Files for
 * `GET .../documents/{id}`. Nothing in the sample Room is unread.
 */
function rawDocument(viewer: Viewer, doc: DemoDocument, detail: boolean) {
  const raw: Record<string, unknown> = {
    id: doc.id,
    room_id: DEMO_ROOM_ID,
    name: doc.name,
    subtitle: doc.subtitle,
    description: doc.description,
    visibility: doc.visibility,
    images: [],
    tag_ids: doc.tag_ids,
    owner_ids: doc.owner_ids,
    selective_user_ids: doc.selective_user_ids,
    played_by: doc.played_by,
  };
  if (!detail) return { ...raw, unread_count: 0 };
  const canManage = viewer.isMaster || doc.owner_ids.includes(viewer.id);
  return {
    ...raw,
    notes: viewer.notes(doc.id).map((note, position) => ({
      id: note.id,
      document_id: note.document_id,
      title: note.title,
      description: note.description,
      visibility: note.visibility,
      selective_user_ids: note.selective_user_ids,
      position,
      created_at: UPDATED_AT,
      updated_at: UPDATED_AT,
      relational_link: note.relational_link,
      can_edit: canManage || note.author_id === viewer.id,
      can_delete: canManage || note.author_id === viewer.id,
    })),
    files: [],
  };
}

/**
 * A Document's Thread as `GET .../documents/{id}/comments` returns it
 * (`RawComment[]`): the Comments the viewer sees, with their reactions and
 * what the viewer may do with each.
 */
function rawComments(viewer: Viewer, documentId: string) {
  const doc = viewer.data.documents.find((d) => d.id === documentId)!;
  const canModerate = viewer.isMaster || doc.owner_ids.includes(viewer.id);
  const visible = viewer.data.comments.filter((c) => c.document_id === documentId && viewer.seesComment(c));
  const visibleIds = new Set(visible.map((c) => c.id));
  return visible.map((c) => ({
    id: c.id,
    document_id: c.document_id,
    author_id: c.author_id,
    body: c.body,
    visibility: c.visibility,
    selective_user_ids: c.selective_user_ids,
    created_at: c.created_at,
    updated_at: c.created_at,
    deleted: false,
    images: [],
    can_edit: c.author_id === viewer.id,
    can_delete: c.author_id === viewer.id || viewer.isMaster,
    as_character: null,
    parent_id: c.parent_id,
    parent_hidden: Boolean(c.parent_id && !visibleIds.has(c.parent_id)),
    reactions: c.reactions.map((r) => ({
      emoji: r.emoji,
      count: r.user_ids.length,
      reacted_by_me: r.user_ids.includes(viewer.id),
      user_ids: r.user_ids,
    })),
    pinned_at: null,
    resolved_at: null,
    resolved_by: null,
    can_pin: canModerate,
    can_resolve: canModerate,
    promoted_at: null,
    promoted_to: null,
    promoted_document_id: null,
    can_promote: canModerate,
  }));
}

/** Text around the first match of `needle` in `text`, at most about 160 characters. */
function excerptAround(text: string, index: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + 100);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** Where a Document is mentioned, grouped by the Document that mentions it (spec 20). */
function backlinks(viewer: Viewer, targetId: string) {
  const token = `(doc:${targetId})`;
  const name = viewer.document(targetId)!.name;
  const groups = new Map<string, { document_id: string; document_name: string; mentions: unknown[] }>();
  const add = (doc: DemoDocument, mention: Record<string, unknown>, text: string) => {
    const shown = plain(text);
    const group = groups.get(doc.id) ?? { document_id: doc.id, document_name: doc.name, mentions: [] };
    group.mentions.push({
      note_id: null,
      note_title: null,
      comment_id: null,
      comment_author_id: null,
      ...mention,
      excerpt: excerptAround(shown, Math.max(0, shown.indexOf(name))),
    });
    groups.set(doc.id, group);
  };
  for (const doc of viewer.documents()) {
    if (doc.id === targetId) continue;
    if (doc.description.includes(token)) add(doc, { kind: 'description' }, doc.description);
    for (const note of viewer.notes(doc.id)) {
      if (note.description.includes(token)) {
        add(doc, { kind: 'note', note_id: note.id, note_title: note.title }, note.description);
      }
    }
    for (const c of viewer.data.comments) {
      if (c.document_id === doc.id && viewer.seesComment(c) && c.body.includes(token)) {
        add(doc, { kind: 'comment', comment_id: c.id, comment_author_id: c.author_id }, c.body);
      }
    }
  }
  return [...groups.values()];
}

/** The text with the first match of `query` (lower case) marked, or null without one. */
function highlight(text: string, query: string) {
  const at = text.toLowerCase().indexOf(query);
  return at < 0 ? null : { text, highlights: [[at, at + query.length]] };
}

/** A plain substring search over what the viewer sees (spec 21's shape, not its ranking). */
function search(viewer: Viewer, params: URLSearchParams) {
  const query = (params.get('q') ?? '').trim().toLowerCase();
  const limit = Number(params.get('limit')) || 5;
  const kind = params.get('kind');
  const tagIds = params.getAll('tag');
  const docs = viewer
    .documents()
    .filter((doc) => tagIds.every((tagId) => doc.tag_ids.includes(tagId)));
  const hits = { documents: [] as unknown[], notes: [] as unknown[], comments: [] as unknown[], tags: [] as unknown[] };
  if (query) {
    for (const doc of docs) {
      const description = plain(doc.description);
      const title = highlight(doc.name, query);
      const excerpt = highlight(description, query);
      if (title || excerpt) {
        hits.documents.push({ kind: 'document', id: doc.id, document_id: doc.id, document_name: doc.name, title: title ?? { text: doc.name, highlights: [] }, excerpt });
      }
      for (const note of viewer.notes(doc.id)) {
        const noteTitle = highlight(note.title, query);
        const noteText = highlight(plain(note.description), query);
        if (noteTitle || noteText) {
          hits.notes.push({ kind: 'note', id: note.id, document_id: doc.id, document_name: doc.name, title: noteTitle ?? { text: note.title, highlights: [] }, excerpt: noteText });
        }
      }
      for (const c of viewer.data.comments) {
        const body = c.document_id === doc.id && viewer.seesComment(c) ? highlight(plain(c.body), query) : null;
        if (body) hits.comments.push({ kind: 'comment', id: c.id, document_id: doc.id, document_name: doc.name, title: null, excerpt: body });
      }
    }
    for (const tag of viewer.data.tags) {
      const title = highlight(tag.name, query);
      if (title) hits.tags.push({ kind: 'tag', id: tag.id, document_id: null, document_name: null, title, excerpt: null });
    }
  }
  const group = (name: keyof typeof hits) => {
    const items = kind && kind !== name.slice(0, -1) ? [] : hits[name];
    return { items: items.slice(0, limit), has_more: items.length > limit };
  };
  return { documents: group('documents'), notes: group('notes'), comments: group('comments'), tags: group('tags') };
}

/** The Document as a map card or place carries it (`RawMapDocument`). */
function placeDocument(doc: DemoDocument) {
  return { id: doc.id, name: doc.name, subtitle: doc.subtitle, image: null, tag_ids: doc.tag_ids };
}

/**
 * A map as the maps list returns it: no content, the number of Documents
 * on it the viewer sees, and edit rights for the Master only.
 */
function mapSummary(map: Record<string, unknown>, viewer: Viewer) {
  const { groups: _groups, cards, arrows: _arrows, areas: _areas, pins, links: _links, background_url: _bg, ...summary } = map;
  const ids = [...((cards as { document_id: string | null }[] | undefined) ?? []), ...((pins as { document_id: string | null }[] | undefined) ?? [])]
    .map((item) => item.document_id)
    .filter((id): id is string => Boolean(id && viewer.document(id)));
  return { ...summary, document_count: new Set(ids).size, can_edit: viewer.isMaster, can_manage: viewer.isMaster };
}

/** A free map's board as the viewer may see it: hidden cards and their arrows left out. */
function freeMapDetail(map: Record<string, unknown>, viewer: Viewer) {
  const cards = (map.cards as Record<string, unknown>[])
    .filter((card) => (viewer.isMaster || !card.master_only) && (!card.document_id || viewer.document(card.document_id as string)))
    .map((card): Record<string, unknown> => ({ ...card, document: card.document_id ? placeDocument(viewer.document(card.document_id as string)!) : null }));
  const cardIds = new Set(cards.map((card) => card.id as string));
  const arrows = (map.arrows as Record<string, unknown>[]).filter((arrow) => {
    const from = (arrow.from_end as { card_id: string }).card_id;
    const to = (arrow.to_end as { card_id: string }).card_id;
    return (viewer.isMaster || !arrow.master_only) && cardIds.has(from) && cardIds.has(to);
  });
  return { ...mapSummary(map, viewer), groups: map.groups, cards, arrows };
}

/** A geographic map's content (`.../geo`): hidden places and the links to them left out. */
function geoMapDetail(map: Record<string, unknown>, viewer: Viewer) {
  const keep = (item: Record<string, unknown>) =>
    (viewer.isMaster || !item.master_only) && (!item.document_id || Boolean(viewer.document(item.document_id as string)));
  const withDocument = (item: Record<string, unknown>): Record<string, unknown> => ({
    ...item,
    document: item.document_id ? placeDocument(viewer.document(item.document_id as string)!) : null,
  });
  const areas = (map.areas as Record<string, unknown>[]).filter(keep).map(withDocument);
  const pins = (map.pins as Record<string, unknown>[]).filter(keep).map(withDocument);
  const ids = new Set([...areas, ...pins].map((item) => item.id as string));
  const links = (map.links as Record<string, unknown>[]).filter((link) => {
    const ends = [link.from_end, link.to_end] as { area_id: string | null; pin_id: string | null }[];
    return (viewer.isMaster || !link.master_only) && ends.every((end) => ids.has((end.area_id ?? end.pin_id) as string));
  });
  return { ...mapSummary(map, viewer), background_url: map.background_url, areas, pins, links };
}

const MENTION = /#\[(?:\\.|[^\]\\])*\]\(doc:([0-9a-fA-F-]{36})\)/g;

/** The Documents a Document mentions, as the viewer sees them: its description and its Relational links (spec 41). */
function mentionedIds(viewer: Viewer, doc: DemoDocument): Set<string> {
  const texts = [doc.description, ...viewer.notes(doc.id).filter((note) => note.relational_link).map((note) => note.description)];
  const ids = texts.flatMap((text) => [...text.matchAll(MENTION)].map((match) => match[1]));
  return new Set(ids.filter((id) => id !== doc.id && viewer.document(id)));
}

/**
 * A Document's live mention map at depth 1 (spec 36): the Document in the
 * middle, the ones it mentions or that mention it around it. None when it is
 * tied to nothing the viewer sees.
 */
function mentionMap(viewer: Viewer, doc: DemoDocument) {
  const around = viewer.documents().filter((other) => other.id !== doc.id && (mentionedIds(viewer, doc).has(other.id) || mentionedIds(viewer, other).has(doc.id)));
  if (around.length === 0) return null;
  const all = [doc, ...around];
  const cardId = (index: number) => `${doc.id.slice(0, -4)}${String(9000 + index).slice(-4)}`;
  const cards = all.map((other, index) => {
    const angle = (2 * Math.PI * (index - 1)) / around.length;
    return {
      id: cardId(index),
      document_id: other.id,
      document: placeDocument(other),
      text: null,
      group_id: null,
      caption: null,
      image_id: null,
      size: index === 0 ? 'large' : 'normal',
      master_only: false,
      color: index === 0 ? 'gold' : 'default',
      struck: false,
      x: index === 0 ? 0 : Math.round(Math.cos(angle) * 420),
      y: index === 0 ? 0 : Math.round(Math.sin(angle) * 300),
    };
  });
  const arrows = all.flatMap((from, i) =>
    all
      .map((to, j) => ({ to, j }))
      .filter(({ to, j }) => (i === 0 || j === 0) && i !== j && mentionedIds(viewer, from).has(to.id))
      .map(({ j }) => ({
        id: `${cardId(i)}-${j}`,
        from_end: { card_id: cardId(i), group_id: null },
        to_end: { card_id: cardId(j), group_id: null },
        direction: 'forward',
        label: null,
        reverse_label: null,
        label_position: null,
        reverse_label_position: null,
        label_offset: null,
        reverse_label_offset: null,
        color: 'default',
        master_only: false,
      })),
  );
  return {
    id: cardId(99),
    document_id: doc.id,
    depth: 1,
    created_by: MASTER_ID,
    updated_at: UPDATED_AT,
    can_manage: viewer.isMaster,
    cards,
    arrows,
    documents_left_out: 0,
  };
}

type Answer = { status: number; body: unknown };

const NOT_FOUND: Answer = { status: 404, body: { detail: 'Not found' } };

/** Routes a GET to the sample Room's answer; an unknown route is 404, as on the API. */
function answer(path: string, viewer: Viewer): Answer {
  const url = new URL(path, 'http://demo');
  const parts = url.pathname.split('/').filter(Boolean);
  const data = viewer.data;
  const ok = (body: unknown): Answer => ({ status: 200, body });
  const me = data.members.find((member) => member.user_id === MASTER_ID)!;

  switch (url.pathname) {
    case '/rooms':
      return ok([{ room: data.room, role: 'master', is_admin: true }]);
    case '/account':
      return ok({ user_id: me.user_id, email: me.email, display_name: me.display_name, pronouns: null, bio: null, avatar_url: null });
    case '/account/friend-code':
      return ok({ code: 'DEMO', created_at: READ_AT });
    case '/friends':
      return ok({ friends: [], incoming: [], outgoing: [] });
    case '/invitations/mine':
    case '/reveals/mine':
      return ok([]);
  }
  if (parts[0] !== 'rooms' || parts[1] !== DEMO_ROOM_ID) return NOT_FOUND;
  const rest = parts.slice(2);
  const [section, id, sub, subId] = rest;

  if (rest.length === 0) return ok(data.room);
  switch (section) {
    case 'members':
      return rest.length === 1 ? ok(data.members) : NOT_FOUND;
    case 'tags':
      if (rest.length === 1) return ok(data.tags);
      if (id === 'main' && rest.length === 2) {
        return ok(
          data.tags
            .filter((tag) => tag.main_position !== null)
            .sort((a, b) => a.main_position! - b.main_position!)
            .map((tag) => ({ tag_ids: [tag.id] })),
        );
      }
      if (sub === 'backlinks') return ok([]);
      return NOT_FOUND;
    case 'characters':
      return ok(
        viewer
          .documents()
          .filter((doc) => doc.played_by === viewer.id)
          .map((doc) => ({ document_id: doc.id, name: doc.name, image_url: null })),
      );
    case 'search':
      return ok(search(viewer, url.searchParams));
    case 'audit-log':
      return ok({ entries: [], next_before: null });
    case 'exports':
    case 'mention-suggestions':
      return ok(section === 'exports' ? [] : { sources: [] });
    case 'session-zero':
      // The sample Room's Session 0 was never started (spec 46); starting it is a write.
      return rest.length === 1
        ? ok({
            started: false,
            revision: 0,
            can_manage: viewer.isMaster,
            rounds: [],
            round_id: null,
            retro: [],
            lines_veils: [],
            timer: null,
          })
        : NOT_FOUND;
    case 'maps': {
      if (rest.length === 1) return ok(data.maps.map((map) => mapSummary(map, viewer)));
      const map = data.maps.find((candidate) => candidate.id === id);
      if (!map) return NOT_FOUND;
      if (rest.length === 2) {
        // A geographic map's content is read from `.../geo` (spec 38).
        return ok(map.kind === 'free' ? freeMapDetail(map, viewer) : { ...mapSummary(map, viewer), groups: [], cards: [], arrows: [] });
      }
      if (sub === 'geo' && rest.length === 3 && map.kind === 'geographic') return ok(geoMapDetail(map, viewer));
      return NOT_FOUND;
    }
    case 'documents': {
      if (rest.length === 1) return ok(viewer.documents().map((doc) => rawDocument(viewer, doc, false)));
      const doc = viewer.document(id);
      if (!doc) return NOT_FOUND;
      if (rest.length === 2) return ok(rawDocument(viewer, doc, true));
      switch (sub) {
        case 'comments':
          return rest.length === 3 ? ok(rawComments(viewer, doc.id)) : NOT_FOUND;
        case 'backlinks':
          return ok(backlinks(viewer, doc.id));
        case 'versions':
          return subId ? NOT_FOUND : ok([]);
        case 'mention-suggestions':
          return ok({ sources: [] });
        case 'mention-map': {
          const map = rest.length === 3 ? mentionMap(viewer, doc) : null;
          return map ? ok(map) : NOT_FOUND;
        }
        default:
          // No linked map or file is part of the sample Room.
          return NOT_FOUND;
      }
    }
  }
  return NOT_FOUND;
}

/**
 * Answers one request of `apiClient` while the Demo is on. `viewAs` is the
 * member the visitor previews (spec 22b), else the visitor, the Master.
 */
export function demoFetch(path: string, method: string, viewAs: string | null): Response {
  const viewer = new Viewer(viewAs ?? MASTER_ID, demoData(currentLanguage()));
  let result: Answer;
  if (method === 'GET') {
    result = answer(path, viewer);
  } else if (method === 'POST' && /^\/rooms\/[^/]+\/documents\/[^/]+\/read$/.test(path)) {
    // Opening a Document records the visit (spec 19b): answered, nothing stored.
    result = {
      status: 200,
      body: { last_read_at: READ_AT, previous_read_at: READ_AT, revealed: { document: false, note_ids: [], comment_ids: [] } },
    };
  } else {
    result = { status: 403, body: { detail: i18n.t('demo.readOnly') } };
  }
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
