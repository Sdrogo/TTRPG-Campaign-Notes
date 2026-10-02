import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../utils';
import {
  AddReaction,
  MAX_REACTION_EMOJI,
  ReactionChips,
} from '../../../components/comments/CommentReactions';
import type { Comment, Reaction } from '../../../types/comment';
import type { Member } from '../../../types/member';

vi.mock('../../../components/comments/EmojiPicker', () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <div>
      <button onClick={() => onSelect('👍')}>scegli 👍</button>
      <button onClick={() => onSelect('🎲')}>scegli 🎲</button>
    </div>
  ),
}));

const members: Member[] = [
  {
    userId: 'user-1',
    role: 'player',
    isAdmin: false,
    email: null,
    displayName: 'Giocatore',
    pronouns: null,
    bio: null,
    avatarUrl: null,
  },
];

function reaction(overrides: Partial<Reaction> = {}): Reaction {
  return { emoji: '👍', count: 2, reactedByMe: false, userIds: ['user-1', 'gone'], ...overrides };
}

function comment(reactions: Reaction[]): Comment {
  return {
    id: 'comment-1',
    documentId: 'doc-1',
    authorId: 'user-1',
    body: 'Ricordate il sigillo.',
    visibility: 'room',
    selectiveUserIds: [],
    createdAt: '2026-09-21T12:00:00Z',
    updatedAt: '2026-09-21T12:00:00Z',
    deleted: false,
    images: [],
    canEdit: true,
    canDelete: true,
    asCharacter: null,
    parentId: null,
    parentHidden: false,
    reactions,
  };
}

describe('ReactionChips', () => {
  it('draws nothing without reactions', () => {
    renderWithProviders(
      <ReactionChips reactions={[]} members={members} onToggle={vi.fn()} disabled={false} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // Decision 1: a click joins or leaves the emoji; the chip names who reacted,
  // a member who left included (as the unknown-user label).
  it('joins an emoji, leaves one already used, and names who reacted', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ReactionChips
        reactions={[reaction(), reaction({ emoji: '🎲', count: 1, reactedByMe: true, userIds: ['user-1'] })]}
        members={members}
        onToggle={onToggle}
        disabled={false}
      />,
    );

    const thumbs = screen.getByRole('button', {
      name: '👍, 2 reazioni: Giocatore, Utente sconosciuto',
    });
    const dice = screen.getByRole('button', { name: '🎲, 1 reazione: Giocatore' });
    expect(thumbs).toHaveAttribute('aria-pressed', 'false');
    expect(dice).toHaveAttribute('aria-pressed', 'true');

    await user.click(thumbs);
    await user.click(dice);
    expect(onToggle.mock.calls).toEqual([
      ['👍', true],
      ['🎲', false],
    ]);
  });
});

describe('AddReaction', () => {
  it('reacts with the emoji picked, but not again with one already used', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AddReaction
        comment={comment([reaction({ reactedByMe: true })])}
        onToggle={onToggle}
        disabled={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Aggiungi una reazione' }));
    await user.click(await screen.findByRole('button', { name: 'scegli 🎲' }));
    expect(onToggle).toHaveBeenCalledWith('🎲', true);
    expect(screen.queryByRole('button', { name: 'scegli 🎲' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Aggiungi una reazione' }));
    await user.click(await screen.findByRole('button', { name: 'scegli 👍' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('joins an emoji someone else used', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AddReaction comment={comment([reaction()])} onToggle={onToggle} disabled={false} />,
    );

    await user.click(screen.getByRole('button', { name: 'Aggiungi una reazione' }));
    await user.click(await screen.findByRole('button', { name: 'scegli 👍' }));
    expect(onToggle).toHaveBeenCalledWith('👍', true);
  });

  // Decision 1: at most 20 different emoji, so no picker once they're there.
  it('is hidden once the Comment carries the most emoji allowed', () => {
    const full = Array.from({ length: MAX_REACTION_EMOJI }, (_, i) =>
      reaction({ emoji: String.fromCodePoint(0x1f600 + i) }),
    );
    renderWithProviders(<AddReaction comment={comment(full)} onToggle={vi.fn()} disabled={false} />);
    expect(screen.queryByRole('button', { name: 'Aggiungi una reazione' })).not.toBeInTheDocument();
  });
});
