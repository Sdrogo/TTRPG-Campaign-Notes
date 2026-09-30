import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { MAX_DISPLAYED_TAGS, TagFilter } from './TagFilter';
import type { Tag } from '../types/tag';

const tags: Tag[] = [
  { id: 'tag-1', name: 'Luoghi', category: null, mainPosition: null },
  { id: 'tag-2', name: 'PNG', category: null, mainPosition: null },
  { id: 'tag-3', name: 'Oggetti', category: null, mainPosition: null },
  { id: 'tag-4', name: 'Fazioni', category: null, mainPosition: null },
];

function render(value: string[] = []) {
  const onChange = vi.fn();
  renderWithProviders(<TagFilter tags={tags} value={value} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

/** The text of each pill in the field, in order. */
const pills = () =>
  [...document.querySelectorAll('.mantine-Pill-root')].map((pill) => pill.textContent);

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

  // Spec 11.1: the filter stays one line, so extra selections collapse into a
  // "+N" pill instead of wrapping onto a second row.
  it('shows only the first few selected Tags, the rest as "+N"', () => {
    render(['tag-1', 'tag-2', 'tag-3', 'tag-4']);

    expect(MAX_DISPLAYED_TAGS).toBe(2);
    expect(pills()).toEqual(['#Luoghi', '#PNG', '+2']);
  });

  it('can still remove a visible Tag from the selection', async () => {
    const { onChange, user } = render(['tag-1', 'tag-2', 'tag-3']);

    await user.click(document.querySelector('.mantine-Pill-remove') as Element);

    expect(onChange).toHaveBeenCalledWith(['tag-2', 'tag-3']);
  });

  it('shows every Tag when the selection fits', () => {
    render(['tag-1', 'tag-2']);

    expect(pills()).toEqual(['#Luoghi', '#PNG']);
  });

  it('keeps the pill row from wrapping', () => {
    render(['tag-1']);

    const list = document.querySelector('.mantine-MultiSelect-pillsList');
    expect(list).toHaveStyle({ flexWrap: 'nowrap' });
  });
});
