import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../utils';
import { CompactList, CompactListItem } from '../../components/CompactList';

describe('CompactList', () => {
  it('renders its rows as list items, in order, with their actions', () => {
    renderWithProviders(
      <CompactList component="ol">
        <CompactListItem leading={<span>1.</span>} actions={<button>Remove A</button>}>
          A
        </CompactListItem>
        <CompactListItem actionsAtEnd>B</CompactListItem>
      </CompactList>,
    );

    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      '1.ARemove A',
      'B',
    ]);
    expect(screen.getByRole('button', { name: 'Remove A' })).toBeInTheDocument();
  });

  it('is a plain one-column `ul` by default', () => {
    renderWithProviders(
      <CompactList>
        <CompactListItem>A</CompactListItem>
      </CompactList>,
    );

    const list = screen.getByRole('list');
    expect(list.tagName).toBe('UL');
    expect(list.style.display).toBe('');
  });

  // Spec 25 Decision 4: on wide screens the rows flow into columns.
  it('lays the rows out in columns of the given width', () => {
    renderWithProviders(
      <CompactList columnWidth={240}>
        <CompactListItem>A</CompactListItem>
      </CompactList>,
    );

    const list = screen.getByRole('list');
    expect(list.style.display).toBe('grid');
    expect(list.style.gridTemplateColumns).toContain('240px');
  });
});
