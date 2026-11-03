import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolBlock } from '../../../components/landing/ToolBlock';
import type { SectionTool } from '../../../hooks/useLanding';
import { apiFetch } from '../../../lib/apiClient';
import type { RawModule } from '../../../lib/sessionZero';
import { rawDdiStep, rawMember, rawPoll, rawPostItColumn, rawQuestionsStep, rawSection } from '../../fixtures';
import { block } from '../../landingFixtures';
import { renderWithProviders } from '../../utils';

vi.mock('../../../lib/apiClient', async (original) => ({
  ...(await original<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

function tool(kind: RawModule['kind'], extra: Partial<RawModule> = {}, visible = false): SectionTool {
  return {
    moduleId: 'm-1',
    playersVisible: visible,
    module: { id: 'm-1', kind, position: 0, columns: [], ...extra },
  };
}

const toolBlock = (overrides: Record<string, unknown> = {}) =>
  block({ kind: 'tool', tag_ids: [], module_id: 'm-1', tool_kind: 'poll', players_visible: false, ...overrides });

function show(props: Partial<Parameters<typeof ToolBlock>[0]> = {}) {
  return renderWithProviders(
    <ToolBlock
      roomId="room-1"
      sectionId="section-1"
      block={toolBlock()}
      heading="Sondaggio"
      tool={tool('poll', { polls: [rawPoll()] as never })}
      revision={3}
      loading={false}
      isMaster
      {...props}
    />,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/members')) return [rawMember({ role: 'master' })] as never;
    if (path.endsWith('/tags')) return [] as never;
    if (path.endsWith('/visible')) return rawSection() as never;
    return undefined as never;
  });
});

describe('ToolBlock (spec 60)', () => {
  it('shows a hidden tool to the Master as a draft, revealed in one click', async () => {
    show();
    expect(screen.getByText('Bozza')).toBeInTheDocument();
    expect(screen.getByText('Quale sistema?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mostra ai giocatori' }));

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/section-1/tools/m-1/visible', {
      method: 'PUT',
      json: { visible: true },
    });
  });

  it('votes through the Session 0 routes and reads the tools again', async () => {
    show({ tool: tool('poll', { polls: [rawPoll()] as never }, true), block: toolBlock({ players_visible: true }), isMaster: false });
    expect(screen.queryByText('Bozza')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'PbtA' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/session-zero/polls/poll-1/vote', {
        method: 'PUT',
        json: { option_ids: ['opt-2'] },
      }),
    );
  });

  it('draws each kind of tool with the Session 0 step it is', async () => {
    const { unmount } = show({ tool: tool('retro', { columns: [rawPostItColumn()] as never }), block: toolBlock({ tool_kind: 'retro' }) });
    expect(screen.getByText('Lo vogliamo al tavolo')).toBeInTheDocument();
    unmount();
    const questions = show({ tool: tool('questions', { questions: rawQuestionsStep() as never }), block: toolBlock({ tool_kind: 'questions' }) });
    expect(await screen.findByRole('region', { name: 'Domande' })).toBeInTheDocument();
    questions.unmount();
    show({ tool: tool('ddi', { ddi: rawDdiStep() as never }), block: toolBlock({ tool_kind: 'ddi' }) });
    expect(screen.getByRole('region', { name: 'DDI' })).toBeInTheDocument();
  });

  it('waits for its tool, says when it failed, and is left out for a Player who can\'t see it', () => {
    const { unmount } = show({ tool: undefined, loading: true });
    expect(document.querySelector('.mantine-Loader-root')).not.toBeNull();
    unmount();
    const failed = show({ tool: undefined });
    expect(screen.getByText('Impossibile caricare lo strumento.')).toBeInTheDocument();
    failed.unmount();
    show({ tool: undefined, isMaster: false });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('starts folded when set so, and opens when the Index scrolls to it', () => {
    show({ block: toolBlock({ collapsed: true }) });
    const toggle = screen.getByRole('button', { name: /Sondaggio/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    act(() => {
      window.dispatchEvent(new CustomEvent('room-landing:reveal-block', { detail: 'other' }));
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    act(() => {
      window.dispatchEvent(new CustomEvent('room-landing:reveal-block', { detail: 'block-1' }));
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('folds from the caret before the edit bar in edit mode, with no reveal button', async () => {
    show({ bar: <div>La barra</div> });
    expect(screen.getByText('La barra')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mostra ai giocatori' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Comprimi Sondaggio' }));
    expect(screen.getByRole('button', { name: 'Espandi Sondaggio' })).toHaveAttribute('aria-expanded', 'false');
  });
});
