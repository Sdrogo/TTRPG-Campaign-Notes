import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { MentionSuggestions, type MentionCreateProps } from './MentionSuggestions';
import type { MentionTarget } from '../../lib/documentMentions';
import type { Document } from '../../types/document';

function document(id: string, name: string): Document {
  return {
    id,
    roomId: 'room-1',
    name,
    description: '',
    visibility: 'room',
    images: [],
    tagIds: [],
    ownerIds: [],
    selectiveUserIds: [],
  };
}

const candidates: MentionTarget[] = [
  {
    kind: 'document',
    document: document('doc-1', 'Il Cancello'),
    tags: [{ id: 'tag-1', name: 'Luoghi', category: null }],
  },
  { kind: 'tag', tag: { id: 'tag-1', name: 'Luoghi', category: null }, documentCount: 3 },
];

function render(props: Partial<Parameters<typeof MentionSuggestions>[0]> = {}) {
  const onHover = vi.fn();
  const onPick = vi.fn();
  renderWithProviders(
    <MentionSuggestions
      listId="mentions"
      candidates={candidates}
      activeIndex={0}
      onHover={onHover}
      onPick={onPick}
      create={null}
      {...props}
    />,
  );
  return { onHover, onPick, user: userEvent.setup() };
}

function createProps(overrides: Partial<MentionCreateProps> = {}): MentionCreateProps {
  return {
    name: 'Nuovo Luogo',
    kinds: ['document', 'tag'],
    kind: 'document',
    onKindChange: vi.fn(),
    highlighted: false,
    creating: false,
    onCreate: vi.fn(),
    ...overrides,
  };
}

describe('MentionSuggestions', () => {
  it('lists each candidate as an option', () => {
    render();

    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('Il Cancello')).toBeInTheDocument();
  });

  it("shows a Document's Tags as its detail line", () => {
    render();

    expect(screen.getByText('#Luoghi')).toBeInTheDocument();
  });

  it('counts the Documents behind a Tag', () => {
    render();

    expect(screen.getByText('Tag · 3 Documenti')).toBeInTheDocument();
  });

  it('uses the singular for a Tag on one Document', () => {
    render({ candidates: [{ ...candidates[1], documentCount: 1 } as MentionTarget] });

    expect(screen.getByText('Tag · 1 Documento')).toBeInTheDocument();
  });

  // The active option drives the keyboard selection and `aria-activedescendant`.
  it('marks the active option as selected', () => {
    render({ activeIndex: 1 });

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('reports the option the pointer moved onto', async () => {
    const { onHover, user } = render();

    await user.hover(screen.getAllByRole('option')[1]);

    expect(onHover).toHaveBeenCalledWith(1);
  });

  it('reports the picked target', async () => {
    const { onPick, user } = render();

    await user.click(screen.getByText('Il Cancello'));

    expect(onPick).toHaveBeenCalledWith(candidates[0]);
  });

  it('says so when nothing matched and nothing can be created', () => {
    render({ candidates: [], create: null });

    expect(screen.getByText('Nessun risultato')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('creating from the popup', () => {
  it('offers to create the typed name', () => {
    render({ candidates: [], create: createProps() });

    expect(screen.getByText(/Nessun risultato per «Nuovo Luogo»/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crea Documento/ })).toBeInTheDocument();
  });

  // Only offered when something matched nothing: a Document that exists is
  // mentioned, not recreated.
  it('is not offered while there are matches', () => {
    render({ candidates, create: createProps() });

    expect(screen.queryByRole('button', { name: /Crea Documento/ })).not.toBeInTheDocument();
  });

  it('switches between the kinds the viewer may create', async () => {
    const onKindChange = vi.fn();
    const { user } = render({ candidates: [], create: createProps({ onKindChange }) });

    await user.click(screen.getByRole('button', { name: 'Tag' }));

    expect(onKindChange).toHaveBeenCalledWith('tag');
  });

  // The UI only offers what the backend would allow: a Player who may not
  // create Tags gets no switch at all.
  it('shows no switch when only one kind is allowed', () => {
    render({ candidates: [], create: createProps({ kinds: ['document'] }) });

    expect(screen.queryByRole('button', { name: 'Tag' })).not.toBeInTheDocument();
    expect(screen.getByText('Documento')).toBeInTheDocument();
  });

  it('marks the selected kind as pressed', () => {
    render({ candidates: [], create: createProps({ kind: 'tag' }) });

    expect(screen.getByRole('button', { name: 'Tag' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Documento' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('creates on click', async () => {
    const onCreate = vi.fn();
    const { user } = render({ candidates: [], create: createProps({ onCreate }) });

    await user.click(screen.getByRole('button', { name: /Crea Documento/ }));

    expect(onCreate).toHaveBeenCalled();
  });

  it('explains the keyboard shortcuts only while highlighted', () => {
    render({ candidates: [], create: createProps({ highlighted: true }) });

    expect(screen.getByText(/←\/→ cambia tipo · Invio per creare/)).toBeInTheDocument();
  });

  it('drops the kind hint when only one kind is offered', () => {
    render({
      candidates: [],
      create: createProps({ highlighted: true, kinds: ['tag'], kind: 'tag' }),
    });

    expect(screen.getByText('Invio per creare')).toBeInTheDocument();
  });

  it('shows the creation in progress', () => {
    render({ candidates: [], create: createProps({ creating: true }) });

    expect(screen.getByRole('button', { name: /Crea Documento/ })).toHaveAttribute(
      'data-loading',
      'true',
    );
  });
});
