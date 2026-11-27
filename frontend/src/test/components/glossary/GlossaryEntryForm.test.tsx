import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../utils';
import { GlossaryEntryForm } from '../../../components/glossary/GlossaryEntryForm';
import { EMPTY_GLOSSARY_VALUES } from '../../../lib/glossary';
import type { GlossaryFormValues } from '../../../types/glossary';
import type { Member } from '../../../types/member';

const members: Member[] = [
  {
    userId: 'u2',
    role: 'player',
    isAdmin: false,
    email: null,
    displayName: 'Ara',
    pronouns: null,
    bio: null,
    avatarUrl: null,
  },
];
const documents = [
  {
    id: 'doc-1',
    roomId: 'room-1',
    name: 'Castello',
    description: '',
    visibility: 'room',
    images: [],
    tagIds: [],
    ownerIds: [],
    selectiveUserIds: [],
    notes: [],
    files: [],
    playedBy: null,
    subtitle: null,
  },
] as never;
const tags = [{ id: 'tag-1', name: 'Regola', category: null, mainPosition: null }];

function setup(initial: Partial<GlossaryFormValues> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  renderWithProviders(
    <GlossaryEntryForm
      initialValues={{ ...EMPTY_GLOSSARY_VALUES, ...initial }}
      members={members}
      tags={tags}
      documents={documents}
      submitLabel="Salva"
      submitting={false}
      error={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );
  return { onSubmit, onCancel, user: userEvent.setup() };
}

describe('GlossaryEntryForm', () => {
  it('sends what was filled in: term, aliases, definition, Tags, Documents, visibility, switch', async () => {
    const { onSubmit, user } = setup();

    await user.type(screen.getByLabelText(/^Termine/), 'Nebbia');
    await user.type(screen.getByRole('combobox', { name: /^Alias/ }), 'Foschia,');
    await user.type(screen.getByLabelText('Definizione'), 'Una coltre');
    await user.click(screen.getByRole('combobox', { name: 'Tag' }));
    await user.click(await screen.findByRole('option', { name: '#Regola' }));
    await user.click(screen.getByRole('combobox', { name: 'Documenti collegati' }));
    await user.click(await screen.findByRole('option', { name: 'Castello' }));
    await user.click(screen.getByRole('combobox', { name: 'Visibilità' }));
    await user.click(await screen.findByRole('option', { name: /^Selettiva/ }));
    await user.click(screen.getByRole('combobox', { name: 'Membri che possono vedere la Nota' }));
    await user.click(await screen.findByRole('option', { name: 'Ara' }));
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        term: 'Nebbia',
        aliases: ['Foschia'],
        definition: 'Una coltre',
        tagIds: ['tag-1'],
        documentIds: ['doc-1'],
        visibility: 'selective',
        selectiveUserIds: ['u2'],
        highlight: false,
      }),
    );
  });

  it('does not send without a term, and cancels', async () => {
    const { onSubmit, onCancel, user } = setup();

    fireEvent.submit(screen.getByRole('button', { name: 'Salva' }).closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Salva' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
