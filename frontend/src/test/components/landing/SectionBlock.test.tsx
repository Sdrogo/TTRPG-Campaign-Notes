import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SectionBlock } from '../../../components/landing/SectionBlock';
import { blockContent, type BlockSources } from '../../../components/landing/blockItems';
import type { LandingBlock } from '../../../types/landing';
import { rawPoll } from '../../fixtures';
import { block, doc, map, overview, tag } from '../../landingFixtures';
import { renderWithProviders } from '../../utils';

const tags = [tag('t1', 'Tokyo'), tag('t2', 'PNG')];

function show(shown: LandingBlock, sources: Partial<BlockSources>, isMaster = false, extra: Partial<Parameters<typeof SectionBlock>[0]> = {}) {
  const all = { tags, ...sources };
  return renderWithProviders(
    <SectionBlock roomId="room-1" block={shown} heading="Il blocco" content={blockContent(shown, all)} isMaster={isMaster} {...extra} />,
  );
}

describe('SectionBlock', () => {
  it('waits for its items', () => {
    show(block(), {});
    expect(screen.getByRole('region', { name: 'Il blocco' })).toHaveAttribute('id', 'block-block-1');
    expect(screen.getByRole('heading', { level: 2, name: 'Il blocco' })).toBeInTheDocument();
  });

  it('is left out when the viewer sees nothing, and says so to the Master', () => {
    const empty = block({ kind: 'maps', tag_ids: [] });
    const { unmount } = show(empty, { maps: [] });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    unmount();
    show(empty, { maps: [] }, true);
    expect(screen.getByText('Niente da mostrare')).toBeInTheDocument();
  });

  it('lists maps with their description or kind', () => {
    show(block({ kind: 'maps', tag_ids: [] }), {
      maps: [map({ id: 'm1', name: 'Corte' }), map({ id: 'm2', name: 'Atlante', kind: 'geographic', description: '' }), map({ id: 'm3', name: 'Rete', description: '' })],
    });
    expect(screen.getByRole('link', { name: 'Corte' })).toHaveAttribute('href', '/rooms/room-1/maps/m1');
    expect(screen.getByText('Chi serve chi')).toBeInTheDocument();
    expect(screen.getByText('Geografiche')).toBeInTheDocument();
    expect(screen.getByText('Relazioni')).toBeInTheDocument();
  });

  it('lists Documents in foldable groups, with their first image', async () => {
    const image = { id: 'i', url: 'http://img/aiko.webp', isFavorite: true };
    show(block({ tag_ids: ['t1'], groups: [['t2']] }), {
      documents: [doc('a', 'Aiko', ['t1', 't2'], { images: [image] }), doc('b', 'Bunta', ['t1'], { description: 'Boss' })],
    });
    expect(screen.getByRole('link', { name: 'Aiko' })).toHaveAttribute('href', '/rooms/room-1/documents/a');
    expect(screen.getByText('Boss')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /#PNG/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Altri documenti/ })).toBeInTheDocument();
  });

  it('lists a Documents block without groups in one grid', () => {
    show(block({ tag_ids: ['t1'] }), { documents: [doc('a', 'Aiko', ['t1'])] });
    expect(screen.getByRole('link', { name: 'Aiko' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lists every Session 0 feature, linked to its session and step', () => {
    const data = overview({
      rounds: [
        {
          id: 'round-2',
          number: 2,
          title: 'Seconda',
          started_at: '2026-10-28T09:00:00Z',
          closed_at: '2026-10-29T09:00:00Z',
          steps: [{ id: 'step-poll-2', kind: 'poll', position: 0, cards: 0, polls: [rawPoll({ id: 'poll-2', body: 'Chiuso?', closed: true })] }],
        },
      ],
    });
    // The newest session first, then the open Session 0 of the fixture.
    data.rounds.push(...overview().rounds);
    show(block({ kind: 'session_zero', tag_ids: [], features: ['sessions', 'retro', 'lines_veils', 'polls', 'ddi'] }), { overview: data }, true);
    const sessions = screen.getByRole('button', { name: /Sessioni/ }).closest('.document-group') as HTMLElement;
    expect(within(sessions).getByRole('link', { name: 'Seconda' })).toHaveAttribute('href', '/rooms/room-1/session-zero?session=round-2');
    expect(within(sessions).getByRole('link', { name: 'Sessione 0' })).toBeInTheDocument();
    expect(within(sessions).getAllByText('In corso')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Retro · Sessione 0' })).toHaveAttribute(
      'href',
      '/rooms/room-1/session-zero?session=round-1&step=step-retro',
    );
    expect(screen.getByRole('link', { name: 'Linee e Veli' })).toHaveAttribute('href', '/rooms/room-1/session-zero');
    expect(screen.getByText('Linee 0 · Veli 2 · Must 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chiuso?' })).toHaveAttribute('href', '/rooms/room-1/session-zero?session=round-2&step=step-poll-2');
    expect(screen.getByRole('link', { name: 'Quale sistema?' })).toBeInTheDocument();
    expect(screen.getByText('Accettata da 0 giocatori')).toBeInTheDocument();
  });

  it('puts the edit bar, the handles and the wrapper in place', () => {
    show(
      block({ tag_ids: ['t1'], groups: [['t2']] }),
      { documents: [doc('a', 'Aiko', ['t1', 't2']), doc('b', 'Bunta', ['t1'])] },
      true,
      {
        bar: <div>La barra</div>,
        partHandle: (key) => <span>maniglia {key}</span>,
        wrapParts: (parts, keys) => <div data-testid="parts" data-keys={keys.join(',')}>{parts}</div>,
      },
    );
    expect(screen.getByText('La barra')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.getByText('maniglia t2')).toBeInTheDocument();
    expect(screen.getByTestId('parts')).toHaveAttribute('data-keys', 't2,ungrouped');
  });
});
