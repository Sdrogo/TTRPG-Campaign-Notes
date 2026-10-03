import { describe, expect, it } from 'vitest';
import {
  NO_AUDIENCE,
  commentReveal,
  documentReveal,
  hasUnseenReveal,
  noteReveal,
  notesHiddenFromGains,
  revealWidens,
  revealedAudience,
  type ContentAudience,
} from '../../lib/reveal';
import type { Comment } from '../../types/comment';
import type { Document } from '../../types/document';
import type { Member } from '../../types/member';
import type { Note } from '../../types/note';
import type { MyReveal } from '../../types/reveal';

function member(userId: string, role: Member['role'] = 'player'): Member {
  return {
    userId,
    role,
    isAdmin: false,
    email: null,
    displayName: userId,
    pronouns: null,
    bio: null,
    avatarUrl: null,
  };
}

const members = [member('master', 'master'), member('owner'), member('alice'), member('bob')];
const ids = (list: Member[]) => list.map((m) => m.userId);

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    documentId: 'doc-1',
    title: 'Porta segreta',
    description: '',
    visibility: 'master',
    selectiveUserIds: [],
    position: 0,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
    canEdit: true,
    canDelete: true,
    ...overrides,
  };
}

function document(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    roomId: 'room-1',
    name: 'Il Cancello',
    description: '',
    visibility: 'master',
    images: [],
    tagIds: [],
    ownerIds: ['owner'],
    selectiveUserIds: [],
    playedBy: null,
    notes: [],
    files: [],
    ...overrides,
  };
}

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-1',
    documentId: 'doc-1',
    authorId: 'alice',
    body: 'Psst',
    visibility: 'master',
    selectiveUserIds: [],
    createdAt: '2026-10-02T12:00:00Z',
    updatedAt: '2026-10-02T12:00:00Z',
    deleted: false,
    images: [],
    canEdit: false,
    canDelete: false,
    asCharacter: null,
    parentId: null,
    parentHidden: false,
    reactions: [],
    pinnedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    canPin: false,
    canResolve: false,
    promotedAt: null,
    promotedTo: null,
    promotedDocumentId: null,
    canPromote: false,
    ...overrides,
  };
}

const masterOnly: ContentAudience = { visibility: 'master', ownerIds: ['owner'], selectiveUserIds: [] };

describe('revealedAudience', () => {
  it('changes nothing while nobody is chosen', () => {
    expect(revealedAudience(masterOnly, NO_AUDIENCE)).toBe(masterOnly);
  });

  it('opens to the Room, or keeps what already is', () => {
    expect(revealedAudience(masterOnly, { toRoom: true, userIds: [] }).visibility).toBe('room');
    const room = { ...masterOnly, visibility: 'room' as const };
    expect(revealedAudience(room, { toRoom: false, userIds: ['alice'] })).toEqual(room);
  });

  it('adds chosen members to a Selective list', () => {
    const selective = { ...masterOnly, visibility: 'selective' as const, selectiveUserIds: ['bob'] };
    expect(revealedAudience(selective, { toRoom: false, userIds: ['alice', 'bob'] })).toEqual({
      ...selective,
      selectiveUserIds: ['bob', 'alice'],
    });
  });

  it('turns Master only or Private into Selective with the chosen members alone', () => {
    const priv = { ...masterOnly, visibility: 'private' as const, selectiveUserIds: ['stale'] };
    expect(revealedAudience(priv, { toRoom: false, userIds: ['alice'] })).toEqual({
      ...priv,
      visibility: 'selective',
      selectiveUserIds: ['alice'],
    });
  });
});

describe('revealWidens', () => {
  it('needs someone new to see it', () => {
    expect(revealWidens(masterOnly, NO_AUDIENCE, members)).toBe(false);
    expect(revealWidens(masterOnly, { toRoom: false, userIds: ['alice'] }, members)).toBe(true);
    // The Owner already sees a Selective item.
    const selective = { ...masterOnly, visibility: 'selective' as const };
    expect(revealWidens(selective, { toRoom: false, userIds: ['owner'] }, members)).toBe(false);
  });
});

describe('documentReveal', () => {
  it('offers who does not see it and names who gains it', () => {
    const reveal = documentReveal(document(), members);

    expect(ids(reveal.pickable)).toEqual(['owner', 'alice', 'bob']);
    expect(ids(reveal.gains({ toRoom: true, userIds: [] }))).toEqual(['owner', 'alice', 'bob']);
    // Selective includes the Owners, so they gain it too (the dialog says so).
    expect(ids(reveal.gains({ toRoom: false, userIds: ['alice'] }))).toEqual(['owner', 'alice']);
  });
});

describe('noteReveal', () => {
  it('only reaches members who see the Document', () => {
    const doc = document({ visibility: 'selective', selectiveUserIds: ['alice'] });
    const reveal = noteReveal(note(), doc, members);

    expect(ids(reveal.pickable)).toEqual(['owner', 'alice']);
    expect(ids(reveal.gains({ toRoom: true, userIds: [] }))).toEqual(['owner', 'alice']);
    expect(reveal.current).toEqual({ visibility: 'master', ownerIds: ['owner'], selectiveUserIds: [] });
  });
});

describe('commentReveal', () => {
  it('follows the effective visibility and never counts the author', () => {
    const parent = comment({ id: 'parent', authorId: 'bob', visibility: 'private' });
    const reply = comment({ id: 'reply', parentId: 'parent', authorId: 'alice' });
    const reveal = commentReveal(reply, [parent, reply], document({ visibility: 'room' }), members);

    // Alice wrote it; nobody else but the Master sees it.
    expect(ids(reveal.pickable)).toEqual(['owner', 'bob']);
    // Only Bob also sees the parent, so only he gains the reply.
    expect(ids(reveal.gains({ toRoom: true, userIds: [] }))).toEqual(['bob']);
    expect(reveal.current.ownerIds).toEqual(['alice']);
  });
});

describe('notesHiddenFromGains', () => {
  it('lists the Notes a member gaining the Document still would not see', () => {
    const roomNote = note({ id: 'open', visibility: 'room' });
    const secret = note({ id: 'secret', visibility: 'master' });
    const ownersOnly = note({ id: 'owners', visibility: 'private' });
    const doc = document({ notes: [roomNote, secret, ownersOnly] });

    expect(notesHiddenFromGains(doc, [member('owner')]).map((n) => n.id)).toEqual(['secret']);
    expect(notesHiddenFromGains(doc, [member('alice')]).map((n) => n.id)).toEqual([
      'secret',
      'owners',
    ]);
    expect(notesHiddenFromGains(doc, [])).toEqual([]);
  });
});

describe('hasUnseenReveal', () => {
  const reveal = { documentId: 'doc-1' } as MyReveal;

  it('marks a Document with anything revealed on it', () => {
    expect(hasUnseenReveal([reveal], 'doc-1')).toBe(true);
    expect(hasUnseenReveal([reveal], 'doc-2')).toBe(false);
    expect(hasUnseenReveal(undefined, 'doc-1')).toBe(false);
  });
});
