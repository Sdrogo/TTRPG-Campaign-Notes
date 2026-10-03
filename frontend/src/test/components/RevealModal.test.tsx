import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../utils';
import { RevealModal } from '../../components/RevealModal';
import { documentReveal, notesHiddenFromGains } from '../../lib/reveal';
import type { Document } from '../../types/document';
import type { Member } from '../../types/member';
import type { Note } from '../../types/note';

function member(userId: string, displayName: string, role: Member['role'] = 'player'): Member {
  return {
    userId,
    role,
    isAdmin: false,
    email: null,
    displayName,
    pronouns: null,
    bio: null,
    avatarUrl: null,
  };
}

const members = [
  member('master', 'Master', 'master'),
  member('owner', 'Owner'),
  member('alice', 'Alice'),
];

function note(id: string, title: string, visibility: Note['visibility']): Note {
  return {
    id,
    documentId: 'doc-1',
    title,
    description: '',
    visibility,
    selectiveUserIds: [],
    position: 0,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
    canEdit: true,
    canDelete: true,
  };
}

const doc: Document = {
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
  notes: [note('secret', 'Trappola', 'master'), note('owners', 'Chiave', 'private')],
  files: [],
};

function render(overrides: Partial<Parameters<typeof RevealModal>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <RevealModal
      name="Il Cancello"
      members={members}
      {...documentReveal(doc, members)}
      hiddenNotes={(gains) => notesHiddenFromGains(doc, gains)}
      loading={false}
      onConfirm={onConfirm}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { user: userEvent.setup(), onConfirm, onClose };
}

const confirmButton = () => screen.getByRole('button', { name: 'Rivela' });

describe('RevealModal', () => {
  it('waits for an audience before it can reveal', () => {
    render();

    expect(screen.getByRole('dialog', { name: 'Rivela "Il Cancello"' })).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(screen.queryByText(/Ottengono accesso/)).not.toBeInTheDocument();
  });

  // Spec 22 Decisions 1 and 2: who gains access, and the Notes still hidden
  // from them, each unchecked.
  it('reveals to the whole Room with the Notes picked', async () => {
    const { user, onConfirm } = render();

    await user.click(screen.getByRole('radio', { name: 'A tutta la Stanza' }));

    expect(screen.getByText('Ottengono accesso: Owner, Alice')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Trappola' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Chiave' }));
    await user.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledWith({ toRoom: true, userIds: [] }, ['owners']);
  });

  it('reveals to chosen players, dropping a Note no longer offered', async () => {
    const { user, onConfirm } = render();

    await user.click(screen.getByRole('radio', { name: 'A tutta la Stanza' }));
    await user.click(screen.getByRole('checkbox', { name: 'Chiave' }));
    await user.click(screen.getByRole('radio', { name: 'Ai giocatori scelti' }));
    await user.click(screen.getByRole('combobox', { name: 'Giocatori' }));
    await user.click(screen.getByRole('option', { name: 'Owner' }));

    // The Owner alone sees the Owners-only Note already.
    expect(screen.queryByRole('checkbox', { name: 'Chiave' })).not.toBeInTheDocument();
    await user.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledWith({ toRoom: false, userIds: ['owner'] }, []);
  });

  it('says when nobody else gains access', async () => {
    const { user } = render({ gains: () => [] });

    await user.click(screen.getByRole('radio', { name: 'A tutta la Stanza' }));

    expect(screen.getByText('Nessun altro membro ottiene accesso.')).toBeInTheDocument();
  });

  it('says when there is nobody left to choose', () => {
    render({ pickable: [], hiddenNotes: undefined });

    expect(screen.getByText('Ogni membro che può riceverlo lo vede già.')).toBeInTheDocument();
  });

  it('closes on cancel', async () => {
    const { user, onClose, onConfirm } = render();

    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
