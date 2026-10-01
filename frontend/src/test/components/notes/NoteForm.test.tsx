import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../utils';
import { NoteForm } from '../../../components/notes/NoteForm';
import { EMPTY_NOTE_VALUES, MAX_NOTE_TITLE_LENGTH } from '../../../lib/notes';
import type { Member } from '../../../types/member';
import type { NoteFormValues } from '../../../types/note';

function member(overrides: Partial<Member> = {}): Member {
  return {
    userId: 'user-1',
    role: 'player',
    isAdmin: false,
    email: 'giocatore@example.com',
    displayName: 'Giocatore',
    pronouns: null,
    bio: null,
    avatarUrl: null,
    ...overrides,
  };
}

const members = [
  member(),
  member({ userId: 'user-2', displayName: 'Master', email: 'master@example.com' }),
];

function render(initialValues: NoteFormValues = EMPTY_NOTE_VALUES, submitting = false) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  renderWithProviders(
    <NoteForm
      initialValues={initialValues}
      members={members}
      submitLabel="Aggiungi Nota"
      onSubmit={onSubmit}
      submitting={submitting}
      onCancel={onCancel}
    />,
  );
  return { onSubmit, onCancel, user: userEvent.setup() };
}

const title = () => screen.getByRole('textbox', { name: /Titolo/ });
const submit = () => screen.getByRole('button', { name: 'Aggiungi Nota' });

describe('NoteForm', () => {
  it('starts from the values it is given', () => {
    render({
      title: 'Porta segreta',
      description: 'Dietro la libreria.',
      visibility: 'master',
      selectiveUserIds: [],
    });

    expect(title()).toHaveValue('Porta segreta');
    expect(screen.getByRole('textbox', { name: 'Descrizione' })).toHaveValue('Dietro la libreria.');
    expect(screen.getByRole('combobox', { name: 'Visibilità' })).toHaveValue('Solo Master');
  });

  it('cannot be saved without a title', async () => {
    const { onSubmit, user } = render();

    expect(submit()).toBeDisabled();
    await user.type(title(), '   ');
    expect(submit()).toBeDisabled();
    // Enter in the title field submits the form too: that must not slip through.
    fireEvent.submit(title());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('limits the title to what the backend accepts', () => {
    render();

    expect(title()).toHaveAttribute('maxlength', String(MAX_NOTE_TITLE_LENGTH));
  });

  it('submits the typed title and description', async () => {
    const { onSubmit, user } = render();

    await user.type(title(), 'Trappola');
    await user.type(screen.getByRole('textbox', { name: 'Descrizione' }), 'Un dardo avvelenato.');
    await user.click(submit());

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Trappola',
      description: 'Un dardo avvelenato.',
      visibility: 'room',
      selectiveUserIds: [],
    });
  });

  it('asks who may see a Selective Note, and only then', async () => {
    const { user } = render();
    const grants = () =>
      screen.queryByRole('combobox', { name: 'Membri che possono vedere la Nota' });

    expect(grants()).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Visibilità' }));
    await user.click(
      screen.getByText('Selettivo (solo Owner + Master finché non scegli altri)'),
    );

    expect(grants()).toBeInTheDocument();
  });

  it('picks who a Selective Note is shared with', async () => {
    const { onSubmit, user } = render({
      title: 'Segreto',
      description: '',
      visibility: 'selective',
      selectiveUserIds: [],
    });

    await user.click(screen.getByRole('combobox', { name: 'Membri che possono vedere la Nota' }));
    await user.click(screen.getByText('Master (master@example.com)'));
    await user.click(submit());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ selectiveUserIds: ['user-2'] }),
    );
  });

  it('cancels without saving', async () => {
    const { onSubmit, onCancel, user } = render();

    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows saving in progress', () => {
    render({ ...EMPTY_NOTE_VALUES, title: 'Trappola' }, true);

    expect(submit()).toBeDisabled();
    expect(submit()).toHaveAttribute('data-loading', 'true');
  });
});
