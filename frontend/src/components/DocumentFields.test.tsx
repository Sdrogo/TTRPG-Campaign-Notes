import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { DocumentFields } from './DocumentFields';
import type { DocumentFormValues } from '../types/document';
import type { Tag } from '../types/tag';

const tags: Tag[] = [
  { id: 'tag-1', name: 'Luoghi', category: null },
  { id: 'tag-2', name: 'PNG', category: null },
];

function render(overrides: Partial<DocumentFormValues> = {}) {
  const onChange = vi.fn();
  renderWithProviders(
    <DocumentFields
      values={{ name: '', description: '', visibility: 'room', tagIds: [], ...overrides }}
      onChange={onChange}
      tags={tags}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe('DocumentFields', () => {
  it('shows the values it was given', () => {
    render({ name: 'Il Cancello', description: 'Una porta.', tagIds: ['tag-1'] });

    expect(screen.getByRole('textbox', { name: /Nome/ })).toHaveValue('Il Cancello');
    expect(screen.getByRole('textbox', { name: /Descrizione/ })).toHaveValue('Una porta.');
  });

  it('reports a name change without dropping the other fields', async () => {
    const { onChange, user } = render({ description: 'Una porta.' });

    await user.type(screen.getByRole('textbox', { name: /Nome/ }), 'I');

    expect(onChange).toHaveBeenCalledWith({
      name: 'I',
      description: 'Una porta.',
      visibility: 'room',
      tagIds: [],
    });
  });

  it('reports a description change', async () => {
    const { onChange, user } = render({ name: 'Il Cancello' });

    await user.type(screen.getByRole('textbox', { name: /Descrizione/ }), 'U');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'U', name: 'Il Cancello' }),
    );
  });

  it('reports a visibility change', async () => {
    const { onChange, user } = render();

    await user.click(screen.getByRole('combobox', { name: 'Visibilità' }));
    await user.click(screen.getByText('Solo Master'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'master' }));
  });

  it('reports a Tag selection', async () => {
    const { onChange, user } = render();

    await user.click(screen.getByRole('combobox', { name: 'Tag' }));
    await user.click(screen.getByText('Luoghi'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tagIds: ['tag-1'] }));
  });

  it('explains that # links another Document', () => {
    render();

    expect(screen.getByText('Scrivi # per collegare un altro Documento.')).toBeInTheDocument();
  });

  it('marks the name as required', () => {
    render();

    expect(screen.getByRole('textbox', { name: /Nome/ })).toBeRequired();
  });
});
