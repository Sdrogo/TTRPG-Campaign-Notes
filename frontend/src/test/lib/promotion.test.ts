import { describe, expect, it } from 'vitest';
import {
  appendPromotedText,
  promotedText,
  promotionReaches,
  startingVisibility,
  type PromotionAudience,
} from '../../lib/promotion';
import type { Comment } from '../../types/comment';
import type { DocumentVisibility } from '../../types/document';
import type { Member } from '../../types/member';

function member(userId: string, role: Member['role'] = 'player'): Member {
  return {
    userId,
    role,
    isAdmin: false,
    email: `${userId}@example.com`,
    displayName: userId,
    pronouns: null,
    bio: null,
    avatarUrl: null,
  };
}

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-1',
    documentId: 'doc-1',
    authorId: 'author',
    body: 'La chiave è sotto lo zerbino.',
    visibility: 'room',
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
    canPromote: true,
    ...overrides,
  };
}

const members = [
  member('master', 'master'),
  member('author'),
  member('owner'),
  member('friend'),
  member('other'),
];

const audience = (
  visibility: DocumentVisibility,
  overrides: Partial<PromotionAudience> = {},
): PromotionAudience => ({ visibility, ownerIds: ['owner'], selectiveUserIds: [], ...overrides });

const ids = (list: Member[]) => list.map((m) => m.userId);

describe('promotionReaches', () => {
  it('reaches nobody new when the Comment is as wide as the target', () => {
    expect(promotionReaches(comment(), [], members, audience('room'))).toEqual([]);
  });

  it('names who would read a private Comment in a Room-visible Document', () => {
    const narrow = comment({ visibility: 'private' });

    expect(ids(promotionReaches(narrow, [narrow], members, audience('room')))).toEqual([
      'owner',
      'friend',
      'other',
    ]);
  });

  it('counts a Document Owner and its Selective grantees', () => {
    const shared = comment({ visibility: 'selective', selectiveUserIds: ['friend'] });

    expect(ids(promotionReaches(shared, [], members, audience('private')))).toEqual(['owner']);
    expect(
      ids(
        promotionReaches(
          shared,
          [],
          members,
          audience('selective', { selectiveUserIds: ['other'] }),
        ),
      ),
    ).toEqual(['owner', 'other']);
  });

  it('reaches nobody through a "Master only" Document', () => {
    expect(
      promotionReaches(comment({ visibility: 'private' }), [], members, audience('master')),
    ).toEqual([]);
  });

  // Spec 19: a reply is read only by who also reads every Comment above it.
  it("follows a reply's parents", () => {
    const parent = comment({ id: 'p', authorId: 'owner', visibility: 'private' });
    const reply = comment({ id: 'r', parentId: 'p' });

    expect(ids(promotionReaches(reply, [parent, reply], members, audience('room')))).toEqual([
      'friend',
      'other',
    ]);
  });

  it('treats a parent missing from the Thread as hidden', () => {
    const orphan = comment({ parentId: 'gone' });

    expect(ids(promotionReaches(orphan, [orphan], members, audience('room')))).toEqual([
      'master',
      'owner',
      'friend',
      'other',
    ]);
  });
});

describe('promoted text', () => {
  const mentioning = comment({
    body: 'Chiedi a @[Ara](user:11111111-1111-4111-8111-111111111111).',
  });

  it('reads member mentions as @Name', () => {
    expect(promotedText(mentioning)).toBe('Chiedi a @Ara.');
  });

  // Document and Tag tokens are valid in a description too (spec 20).
  it('keeps Document and Tag mentions as tokens', () => {
    const body = 'Vai al #[Il Cancello](doc:22222222-2222-4222-8222-222222222222).';
    expect(promotedText(comment({ body }))).toBe(body);
  });

  it('is added at the end of the description as a paragraph of its own', () => {
    expect(appendPromotedText('Una porta.\n', mentioning)).toBe('Una porta.\n\nChiedi a @Ara.');
    expect(appendPromotedText('  ', mentioning)).toBe('Chiedi a @Ara.');
  });
});

describe('startingVisibility', () => {
  it('keeps Room and starts anything narrower Private', () => {
    expect(startingVisibility(comment())).toBe('room');
    for (const visibility of ['private', 'selective', 'master'] as const) {
      expect(startingVisibility(comment({ visibility }))).toBe('private');
    }
  });
});
