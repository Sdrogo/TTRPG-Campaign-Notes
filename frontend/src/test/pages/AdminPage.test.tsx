import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { useSession } from '../../hooks/useSession';
import { fakeSession, rawAccount } from '../fixtures';
import { renderWithProviders } from '../utils';
import { AdminPage } from '../../pages/AdminPage';
import { BarChart } from '../../components/admin/BarChart';
import type { AdminStats } from '../../types/admin';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../hooks/useSession', () => ({ useSession: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const sessionMock = vi.mocked(useSession);

type SessionState = ReturnType<typeof useSession>;

function stats(overrides: Partial<AdminStats> = {}): AdminStats {
  return {
    generated_at: '2026-11-17T10:00:00Z',
    overview: {
      users: 12,
      new_users_7d: 2,
      new_users_30d: 5,
      active_users_7d: 7,
      active_users_30d: 9,
      rooms: 4,
      documents: 120,
      maps: 3,
      geographic_maps: 1,
      session_zeros: 2,
      clocks: 6,
      files: 8,
      files_bytes: 2048,
      images: 30,
      database_bytes: 10485760,
      sign_ins_by_provider: { google: 10, discord: 2 },
    },
    growth: [
      { week: '2026-11-02T00:00:00Z', new_users: 1, new_rooms: 0 },
      { week: '2026-11-09T00:00:00Z', new_users: 3, new_rooms: 2 },
    ],
    traffic: {
      days: 7,
      hours: [{ hour: '2026-11-17T09:00:00Z', requests: 40, server_errors: 2 }],
      groups: [
        {
          group: 'documents',
          requests: 30,
          client_errors: 1,
          server_errors: 2,
          p50_ms: 50,
          p95_ms: 250,
        },
        {
          group: 'live',
          requests: 10,
          client_errors: 0,
          server_errors: 0,
          p50_ms: null,
          p95_ms: null,
        },
      ],
    },
    errors: [
      {
        occurred_at: '2026-11-17T09:30:00Z',
        method: 'GET',
        route: '/rooms/{room_id}',
        status: 500,
        exc_type: 'RuntimeError',
        request_id: 'abc123',
      },
      {
        occurred_at: '2026-11-17T09:31:00Z',
        method: 'POST',
        route: '/maps',
        status: 503,
        exc_type: null,
        request_id: 'def456',
      },
    ],
    jobs: {
      exports: { running: 1, done_7d: 4, failed_7d: 0 },
      imports: { running: 0, done_7d: 2, failed_7d: 3 },
    },
    ...overrides,
  };
}

function serve(account: Record<string, unknown>, adminStats: AdminStats | Error) {
  fetchMock.mockImplementation((path: string) => {
    if (path === '/account') {
      return Promise.resolve(account);
    }
    return adminStats instanceof Error ? Promise.reject(adminStats) : Promise.resolve(adminStats);
  });
}

function render() {
  return renderWithProviders(<AdminPage />, { route: '/admin' });
}

beforeEach(() => {
  fetchMock.mockReset();
  sessionMock.mockReturnValue({ session: fakeSession(), loading: false } as SessionState);
});

describe('AdminPage', () => {
  it('waits on a loader while the session is resolving', () => {
    sessionMock.mockReturnValue({ session: null, loading: true } as SessionState);

    const { container } = render();

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks an anonymous visitor to sign in', () => {
    sessionMock.mockReturnValue({ session: null, loading: false } as SessionState);

    render();

    expect(screen.getByText('Accedi per aprire questa pagina.')).toBeInTheDocument();
  });

  it('is not available to a user who is not an admin, and never asks for the numbers', async () => {
    serve(rawAccount(), stats());

    render();

    expect(await screen.findByText('Questa pagina non è disponibile.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna alle mie Stanze' })).toHaveAttribute('href', '/rooms');
    expect(fetchMock).not.toHaveBeenCalledWith('/admin/stats');
  });

  it('says so when the numbers cannot be loaded', async () => {
    serve(rawAccount({ app_admin: true }), new Error('boom'));

    render();

    expect(
      await screen.findByText('Non è stato possibile caricare i numeri. Riprova tra poco.'),
    ).toBeInTheDocument();
  });

  it('shows the overview, growth, traffic, errors and jobs', async () => {
    serve(rawAccount({ app_admin: true }), stats());

    render();

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText('google 10 · discord 2')).toBeInTheDocument();
    expect(screen.getByText('2 / 5')).toBeInTheDocument();
    expect(screen.getByText('1 geografiche')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Nuovi utenti per settimana' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Richieste all\'ora' })).toBeInTheDocument();

    const documentsRow = screen.getByText('documents').closest('tr') as HTMLElement;
    expect(within(documentsRow).getByText('≤ 250 ms')).toBeInTheDocument();
    const liveRow = screen.getByText('live').closest('tr') as HTMLElement;
    expect(within(liveRow).getAllByText('–')).toHaveLength(2);

    expect(screen.getByText('GET /rooms/{room_id}')).toBeInTheDocument();
    expect(screen.getByText('RuntimeError')).toBeInTheDocument();
    expect(screen.getByText('def456')).toBeInTheDocument();

    // Running jobs in blue, none in gray: the theme's red is for failures only.
    expect(
      (screen.getByText('In corso: 1').closest('.mantine-Badge-root') as HTMLElement).style.getPropertyValue('--badge-color'),
    ).toBe('var(--mantine-color-blue-light-color)');
    expect(
      (screen.getByText('In corso: 0').closest('.mantine-Badge-root') as HTMLElement).style.getPropertyValue('--badge-color'),
    ).toBe('var(--mantine-color-gray-light-color)');
    expect(screen.getByText('Falliti (7 giorni): 3')).toBeInTheDocument();
  });

  it('says when there is no traffic, no error and no sign-in yet', async () => {
    const empty = stats();
    serve(
      rawAccount({ app_admin: true }),
      stats({
        overview: { ...empty.overview, sign_ins_by_provider: {} },
        traffic: { days: 7, hours: [], groups: [] },
        errors: [],
      }),
    );

    render();

    expect(await screen.findByText('Nessuna richiesta ancora conteggiata.')).toBeInTheDocument();
    expect(screen.getByText('Nessun errore del server. 🎉')).toBeInTheDocument();
    expect(screen.queryByText(/google/)).not.toBeInTheDocument();
  });
});

describe('BarChart', () => {
  it('draws one bar per item, scaled to the largest, with a tooltip', () => {
    const { container } = renderWithProviders(
      <BarChart
        title="Chart"
        bars={[
          { label: 'a', value: 2 },
          { label: 'b', value: 4 },
        ]}
      />,
    );

    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(2);
    expect(rects[0]).toHaveAttribute('height', '50');
    expect(rects[1]).toHaveAttribute('height', '100');
    expect(rects[1].querySelector('title')).toHaveTextContent('b: 4');
  });

  it('draws an empty chart when there is nothing to show', () => {
    const { container } = renderWithProviders(<BarChart title="Empty" bars={[]} />);

    expect(screen.getByRole('img', { name: 'Empty' })).toBeInTheDocument();
    expect(container.querySelectorAll('rect')).toHaveLength(0);
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
