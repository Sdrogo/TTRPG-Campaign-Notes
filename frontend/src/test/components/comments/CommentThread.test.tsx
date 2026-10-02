import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CommentThread } from '../../../components/comments/CommentThread';
import type { BranchState, Comment, CommentNode } from '../../../types/comment';
import { renderWithProviders } from '../../utils';

function comment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    documentId: 'doc-1',
    authorId: 'user-1',
    body: `body ${id}`,
    visibility: 'room',
    selectiveUserIds: [],
    createdAt: '2026-09-21T12:00:00Z',
    updatedAt: '2026-09-21T12:00:00Z',
    deleted: false,
    images: [],
    canEdit: false,
    canDelete: false,
    asCharacter: null,
    parentId: null,
    parentHidden: false,
    reactions: [],
    ...overrides,
  };
}

const node = (id: string, replies: CommentNode[] = [], overrides: Partial<Comment> = {}) => ({
  comment: comment(id, overrides),
  replies,
});

// Draws each Comment as one line: its body, and whom it answers when the
// thread says so.
function Harness({ root }: { root: CommentNode }) {
  const [states, setStates] = useState<Record<string, BranchState>>({});
  return (
    <CommentThread
      node={root}
      branchStates={states}
      onBranchChange={(id, state) => setStates((s) => ({ ...s, [id]: state }))}
      nameOf={(c) => `name ${c.id}`}
      renderComment={(c, inReplyTo) => (
        <p>
          {c.body}
          {inReplyTo && ` > ${inReplyTo}`}
        </p>
      )}
    />
  );
}

function render(root: CommentNode) {
  renderWithProviders(<Harness root={root} />);
  return { user: userEvent.setup() };
}

describe('CommentThread', () => {
  // Decision 1: three levels, deeper replies drawn at the third with whom they answer.
  it('draws a fourth-level reply at the third level, saying whom it answers', () => {
    render(node('a', [node('b', [node('c', [node('d', [node('e')])])])]));

    for (const id of ['a', 'b', 'c']) {
      expect(screen.getByText(`body ${id}`)).toBeInTheDocument();
    }
    expect(screen.getByText('body d > name c')).toBeInTheDocument();
    expect(screen.getByText('body e > name d')).toBeInTheDocument();
  });

  // Decision 4: more than 3 replies start collapsed to the first 2.
  it('collapses a long branch and expands it on request', async () => {
    const { user } = render(node('top', ['a', 'b', 'c', 'd'].map((id) => node(id))));

    expect(screen.getByText('body b')).toBeInTheDocument();
    expect(screen.queryByText('body c')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mostra altre 2 risposte' }));
    expect(screen.getByText('body d')).toBeInTheDocument();
  });

  it('hides any branch by hand and shows it again', async () => {
    const { user } = render(node('top', [node('a')]));

    await user.click(screen.getByRole('button', { name: 'Nascondi risposte' }));
    expect(screen.queryByText('body a')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mostra 1 risposta' }));
    expect(screen.getByText('body a')).toBeInTheDocument();
  });

  it('draws no reply controls for a Comment without replies', () => {
    render(node('alone'));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // Decision 6: the placeholder says nothing about the hidden parent.
  it('puts a reply whose parent is hidden under a placeholder', () => {
    render(node('mine', [node('answer')], { parentHidden: true }));

    expect(screen.getByText('Un commento che non puoi vedere')).toBeInTheDocument();
    expect(screen.getByText('body mine')).toBeInTheDocument();
    expect(screen.getByText('body answer')).toBeInTheDocument();
  });
});
