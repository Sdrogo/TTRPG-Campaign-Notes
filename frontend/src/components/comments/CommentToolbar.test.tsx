import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_COMMENT_FILTERS } from '../../lib/comments';
import { renderWithProviders } from '../../test/utils';
import { CommentToolbar } from './CommentToolbar';
import type { CommentFilters } from '../../types/comment';

const authorOptions = [
  { value: 'user-1', label: 'Giocatore' },
  { value: 'user-2', label: 'Master' },
];

function render(filters: Partial<CommentFilters> = {}) {
  const onChange = vi.fn();
  renderWithProviders(
    <CommentToolbar
      filters={{ ...DEFAULT_COMMENT_FILTERS, ...filters }}
      onChange={onChange}
      authorOptions={authorOptions}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe('CommentToolbar', () => {
  it('reports a search query', async () => {
    const { onChange, user } = render();

    await user.type(screen.getByLabelText('Cerca nei commenti'), 's');

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_COMMENT_FILTERS, query: 's' });
  });

  it('reports a sort change', async () => {
    const { onChange, user } = render();

    await user.click(screen.getByRole('combobox', { name: 'Ordina commenti' }));
    await user.click(screen.getByText('Meno recenti'));

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_COMMENT_FILTERS, sort: 'oldest' });
  });

  it('reports an author filter', async () => {
    const { onChange, user } = render();

    await user.click(screen.getByRole('combobox', { name: 'Filtra per autore' }));
    await user.click(screen.getByText('Master'));

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_COMMENT_FILTERS, authorId: 'user-2' });
  });

  it('reports a visibility filter', async () => {
    const { onChange, user } = render();

    await user.click(screen.getByRole('combobox', { name: 'Filtra per visibilità' }));
    await user.click(screen.getByText('Solo Master'));

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_COMMENT_FILTERS, visibility: 'master' });
  });

  it('reports the hide-deleted toggle', async () => {
    const { onChange, user } = render();

    await user.click(screen.getByLabelText('Nascondi eliminati'));

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_COMMENT_FILTERS, hideDeleted: true });
  });

  // Nothing to reset when nothing is filtered.
  it('hides the reset button while no filter is active', () => {
    render();

    expect(screen.queryByRole('button', { name: /Azzera filtri/ })).not.toBeInTheDocument();
  });

  it('shows the reset button once a filter is active', () => {
    render({ hideDeleted: true });

    expect(screen.getByRole('button', { name: /Azzera filtri/ })).toBeInTheDocument();
  });

  // Sort is a preference, not a filter: resetting the filters shouldn't
  // throw away the order the reader chose.
  it('keeps the chosen sort order when resetting the filters', async () => {
    const { onChange, user } = render({ sort: 'author', query: 'sigillo', hideDeleted: true });

    await user.click(screen.getByRole('button', { name: /Azzera filtri/ }));

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_COMMENT_FILTERS, sort: 'author' });
  });

  it('shows the active filters it was given', () => {
    render({ query: 'sigillo', sort: 'oldest' });

    expect(screen.getByLabelText('Cerca nei commenti')).toHaveValue('sigillo');
    expect(screen.getByRole('combobox', { name: 'Ordina commenti' })).toHaveValue('Meno recenti');
  });
});
