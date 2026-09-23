import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { TagFilter } from './TagFilter';
import type { Tag } from '../types/tag';

const tags: Tag[] = [
  { id: 'tag-1', name: 'Luoghi', category: null },
  { id: 'tag-2', name: 'PNG', category: null },
];

function render(value: string[] = []) {
  const onChange = vi.fn();
  renderWithProviders(<TagFilter tags={tags} value={value} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

const field = () => screen.getByRole('combobox', { name: 'Filtra per Tag' });

describe('TagFilter', () => {
  it('lists the Room\'s Tags as #Name', async () => {
    const { user } = render();

    await user.click(field());

    expect(screen.getByText('#Luoghi')).toBeInTheDocument();
    expect(screen.getByText('#PNG')).toBeInTheDocument();
  });

  it('reports the Tag that was picked', async () => {
    const { onChange, user } = render();

    await user.click(field());
    await user.click(screen.getByText('#Luoghi'));

    expect(onChange).toHaveBeenCalledWith(['tag-1']);
  });

  // Tags combine with AND (FR-N2), so picking a second adds to the first.
  it('adds to the selection rather than replacing it', async () => {
    const { onChange, user } = render(['tag-1']);

    await user.click(field());
    await user.click(screen.getByText('#PNG'));

    expect(onChange).toHaveBeenCalledWith(['tag-1', 'tag-2']);
  });

  it('prompts only while nothing is selected', () => {
    render();

    expect(field()).toHaveAttribute('placeholder', 'Filtra per Tag');
  });

  it('drops the prompt once a Tag is selected', () => {
    render(['tag-1']);

    expect(field()).not.toHaveAttribute('placeholder');
  });
});
