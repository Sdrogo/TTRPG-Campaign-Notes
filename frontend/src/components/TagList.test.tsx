import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { TagList } from './TagList';
import type { Tag } from '../types/tag';

const tags: Tag[] = [
  { id: 'tag-1', name: 'PNG', category: 'Personaggi' },
  { id: 'tag-2', name: 'Luoghi', category: null },
  { id: 'tag-3', name: 'Oggetti', category: null },
];

describe('TagList', () => {
  // `#Name` is how a Tag is written everywhere: in mentions, in the filter,
  // and here (spec 06).
  it('shows the selected Tags with a leading #', () => {
    renderWithProviders(<TagList tags={tags} tagIds={['tag-1', 'tag-2']} />);

    expect(screen.getByText('#PNG')).toBeInTheDocument();
    expect(screen.getByText('#Luoghi')).toBeInTheDocument();
  });

  it('leaves out Tags the Document does not carry', () => {
    renderWithProviders(<TagList tags={tags} tagIds={['tag-1']} />);

    expect(screen.queryByText('#Oggetti')).not.toBeInTheDocument();
  });

  it('renders nothing when the Document has no Tags', () => {
    renderWithProviders(<TagList tags={tags} tagIds={[]} />);

    expect(screen.queryByText(/^#/)).not.toBeInTheDocument();
  });

  // A Tag deleted from the Room can still be referenced by a stale cache
  // entry; it must simply not render rather than blow up.
  it('ignores a tag id with no matching Tag', () => {
    renderWithProviders(<TagList tags={tags} tagIds={['tag-gone']} />);

    expect(screen.queryByText(/^#/)).not.toBeInTheDocument();
  });

  it('keeps the Room\'s Tag order, not the order of the ids given', () => {
    renderWithProviders(<TagList tags={tags} tagIds={['tag-3', 'tag-1']} />);

    const rendered = screen.getAllByText(/^#/).map((node) => node.textContent);
    expect(rendered).toEqual(['#PNG', '#Oggetti']);
  });
});
