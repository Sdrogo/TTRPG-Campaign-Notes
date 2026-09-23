import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { CommentComposer } from './CommentComposer';
import type { CommentFormValues } from '../../types/comment';
import type { Member } from '../../types/member';
import type { StoredImage } from '../../types/image';

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

function render(props: Partial<Parameters<typeof CommentComposer>[0]> = {}) {
  const onSubmit = vi.fn();
  renderWithProviders(
    <CommentComposer
      members={members}
      currentUserId="user-1"
      submitLabel="Pubblica"
      onSubmit={onSubmit}
      submitting={false}
      {...props}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
}

const body = () => screen.getByRole('textbox', { name: 'Testo del commento' });
const submitButton = () => screen.getByRole('button', { name: /Pubblica/ });

describe('CommentComposer', () => {
  it('starts empty at Room visibility', () => {
    render();

    expect(body()).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Visibilità del commento' })).toHaveValue(
      'Stanza (tutti i membri)',
    );
  });

  it('cannot submit an empty Comment', () => {
    render();

    expect(submitButton()).toBeDisabled();
  });

  it('cannot submit a whitespace-only Comment', async () => {
    const { user } = render();

    await user.type(body(), '   ');

    expect(submitButton()).toBeDisabled();
  });

  it('submits the body', async () => {
    const { onSubmit, user } = render();

    await user.type(body(), 'Ricordate il sigillo.');
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Ricordate il sigillo.', visibility: 'room' }),
      expect.any(Function),
    );
  });

  // Long-form text: Enter makes a new line, so sending needs a modifier.
  it('submits on Ctrl+Enter', async () => {
    const { onSubmit, user } = render();

    await user.type(body(), 'Ricordate il sigillo.');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onSubmit).toHaveBeenCalled();
  });

  it('does not submit on a plain Enter', async () => {
    const { onSubmit, user } = render();

    await user.type(body(), 'Prima riga{Enter}seconda');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(body()).toHaveValue('Prima riga\nseconda');
  });

  it('shows the submission in progress', () => {
    render({ submitting: true });

    expect(submitButton()).toHaveAttribute('data-loading', 'true');
  });

  it('cannot submit twice while the first save is in flight', async () => {
    const { onSubmit, user } = render({
      submitting: true,
      initialValues: {
        body: 'Ricordate il sigillo.',
        visibility: 'room',
        selectiveUserIds: [],
        newImages: [],
        removedImageIds: [],
      },
    });

    await user.click(submitButton());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('offers a cancel only when there is somewhere to go back to', () => {
    render();

    expect(screen.queryByRole('button', { name: 'Annulla' })).not.toBeInTheDocument();
  });

  it('cancels when asked', async () => {
    const onCancel = vi.fn();
    const { user } = render({ onCancel });

    await user.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(onCancel).toHaveBeenCalled();
  });

  it('clears itself when the caller reports the save is done', async () => {
    const { onSubmit, user } = render();
    await user.type(body(), 'Ricordate il sigillo.');
    await user.click(submitButton());

    const reset = onSubmit.mock.calls[0][1] as () => void;
    
    act(() => reset());

    expect(body()).toHaveValue('');
  });
});

describe('visibility', () => {
  it('asks who may see a Selective Comment', async () => {
    const { user } = render();

    await user.click(screen.getByRole('combobox', { name: 'Visibilità del commento' }));
    await user.click(screen.getByText('Selettivo (tu, Master e chi scegli)'));

    expect(
      screen.getByRole('combobox', { name: 'Membri che possono vedere il commento' }),
    ).toBeInTheDocument();
  });

  it('asks nobody at the other levels', async () => {
    const { user } = render();

    await user.click(screen.getByRole('combobox', { name: 'Visibilità del commento' }));
    await user.click(screen.getByText('Privato (tu + Master)'));

    expect(
      screen.queryByRole('combobox', { name: 'Membri che possono vedere il commento' }),
    ).not.toBeInTheDocument();
  });

  // VR-02: the author always sees their own Comment, so granting it to
  // themselves is meaningless.
  it('does not offer the author to themselves', async () => {
    const { user } = render({
      initialValues: {
        body: '',
        visibility: 'selective',
        selectiveUserIds: [],
        newImages: [],
        removedImageIds: [],
      },
    });

    await user.click(
      screen.getByRole('combobox', { name: 'Membri che possono vedere il commento' }),
    );

    expect(screen.queryByText('Giocatore (giocatore@example.com)')).not.toBeInTheDocument();
    expect(screen.getByText('Master (master@example.com)')).toBeInTheDocument();
  });
});

describe('images', () => {
  const existingImages: StoredImage[] = [
    { id: 'image-1', url: 'http://a/1.webp', isFavorite: false },
    { id: 'image-2', url: 'http://a/2.webp', isFavorite: false },
  ];

  function editing(values: Partial<CommentFormValues> = {}) {
    return render({
      existingImages,
      initialValues: {
        body: 'Ricordate il sigillo.',
        visibility: 'room',
        selectiveUserIds: [],
        newImages: [],
        removedImageIds: [],
        ...values,
      },
      submitLabel: 'Pubblica',
    });
  }

  it('shows the images already attached', () => {
    editing();

    expect(screen.getAllByAltText('Immagine allegata')).toHaveLength(2);
  });

  // Nothing is uploaded or deleted here: the removal is staged and applied
  // when the Comment is saved.
  it('stages the removal of an existing image', async () => {
    const { onSubmit, user } = editing();

    await user.click(screen.getAllByRole('button', { name: 'Rimuovi Immagine allegata' })[0]);
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ removedImageIds: ['image-1'] }),
      expect.any(Function),
    );
  });

  it('drops a removed image from the strip', async () => {
    const { user } = editing();

    await user.click(screen.getAllByRole('button', { name: 'Rimuovi Immagine allegata' })[0]);

    expect(screen.getAllByAltText('Immagine allegata')).toHaveLength(1);
  });

  it('stages an image added by URL', async () => {
    const { onSubmit, user } = editing({ removedImageIds: ['image-1', 'image-2'] });

    await user.click(screen.getByRole('button', { name: 'Aggiungi immagine da URL' }));
    await user.type(screen.getByLabelText("URL dell'immagine"), 'https://example.com/map.png');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        newImages: [expect.objectContaining({ source: 'https://example.com/map.png' })],
      }),
      expect.any(Function),
    );
  });

  const fullComment = [
    ...existingImages,
    { id: 'image-3', url: 'http://a/3.webp', isFavorite: false },
    { id: 'image-4', url: 'http://a/4.webp', isFavorite: false },
  ];

  // MAX_IMAGES_PER_COMMENT is 4; the backend enforces it too.
  it('stops offering a URL attachment once the Comment is full', () => {
    render({ existingImages: fullComment });

    expect(screen.getByRole('button', { name: 'Aggiungi immagine da URL' })).toBeDisabled();
  });

  // Mantine's `FileButton` only suppresses the click when disabled - it does
  // not pass `disabled` down to the control it renders. So the file picker
  // stays visually enabled at the cap while doing nothing, unlike the URL
  // button next to it. Pinned here so the asymmetry is a decision, not drift.
  it('leaves the file picker looking enabled at the cap, but inert', async () => {
    const { user } = render({ existingImages: fullComment });
    const picker = screen.getByRole('button', { name: 'Aggiungi immagini' });
    const openDialog = vi.spyOn(HTMLInputElement.prototype, 'click');

    await user.click(picker);

    expect(picker).toBeEnabled();
    expect(openDialog).not.toHaveBeenCalled();
  });

  it('frees a slot again when an image is removed', async () => {
    const { user } = render({ existingImages: fullComment });

    await user.click(screen.getAllByRole('button', { name: 'Rimuovi Immagine allegata' })[0]);

    expect(screen.getByRole('button', { name: 'Aggiungi immagine da URL' })).toBeEnabled();
  });
});
