import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { VisibilityBadge } from './VisibilityBadge';
import type { DocumentVisibility } from '../types/document';

describe('VisibilityBadge', () => {
  // The label is what tells a Master at a glance that a Document is hidden
  // from their table, so each level needs its own wording.
  it.each<[DocumentVisibility, string]>([
    ['room', 'Stanza'],
    ['master', 'Solo Master'],
    ['private', 'Privato'],
    ['selective', 'Selettivo'],
  ])('labels %s as "%s"', (visibility, label) => {
    renderWithProviders(<VisibilityBadge visibility={visibility} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders exactly one label, not a list of every level', () => {
    renderWithProviders(<VisibilityBadge visibility="private" />);

    expect(screen.queryByText('Stanza')).not.toBeInTheDocument();
    expect(screen.getByText('Privato')).toBeInTheDocument();
  });
});
