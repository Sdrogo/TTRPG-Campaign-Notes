import { useEffect } from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { setViewAsUser, viewAsUser } from '../../lib/viewAs';
import { useReadOnly, useViewAs } from '../../hooks/useViewAs';
import { ViewAsProvider } from '../../components/ViewAsProvider';
import { AppHeader } from '../../components/AppHeader';
import { rawMember } from '../fixtures';
import { renderWithProviders } from '../utils';

vi.mock('../../lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

// What the pages under the provider see, and a way to move around.
const probe: { go?: ReturnType<typeof useNavigate>; client?: unknown } = {};
function Probe() {
  const viewAs = useViewAs();
  const readOnly = useReadOnly();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useEffect(() => {
    probe.go = navigate;
    probe.client = queryClient;
  });
  return (
    <div>
      <span data-testid="where">{`${location.pathname}${location.search}${location.hash}`}</span>
      <span data-testid="view">{viewAs ? `${viewAs.roomId}:${viewAs.userId}` : 'own'}</span>
      <span data-testid="read-only">{String(readOnly)}</span>
    </div>
  );
}

function render(route: string) {
  const rendered = renderWithProviders(
    <ViewAsProvider>
      <Probe />
    </ViewAsProvider>,
    { route },
  );
  return { ...rendered, ownClient: rendered.queryClient };
}

const view = () => screen.getByTestId('view').textContent;
const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue([
    rawMember({ user_id: 'master', role: 'master', display_name: 'Master' }),
    rawMember({ user_id: 'alice', display_name: 'Alice' }),
  ]);
});

afterEach(() => {
  setViewAsUser(null);
});

describe('viewAs module state', () => {
  it('holds the member being previewed until it is cleared', () => {
    setViewAsUser('alice');
    expect(viewAsUser()).toBe('alice');
    setViewAsUser(null);
    expect(viewAsUser()).toBeNull();
  });
});

describe('ViewAsProvider', () => {
  it("is the signed-in user's own view without the parameter", () => {
    const { ownClient, unmount } = render('/rooms/room-1/documents');

    expect(view()).toBe('own');
    expect(screen.getByTestId('read-only')).toHaveTextContent('false');
    expect(viewAsUser()).toBeNull();
    expect(probe.client).toBe(ownClient);
    unmount();
  });

  it('ignores the parameter outside a Room\'s pages', () => {
    render('/account?as=alice');

    expect(view()).toBe('own');
    expect(viewAsUser()).toBeNull();
  });

  it('previews the Room as the member, read-only, in a separate cache', () => {
    const { ownClient } = render('/rooms/room-1/documents?as=alice');

    expect(view()).toBe('room-1:alice');
    expect(screen.getByTestId('read-only')).toHaveTextContent('true');
    expect(viewAsUser()).toBe('alice');
    expect(probe.client).not.toBe(ownClient);
  });

  it('keeps the preview on a link inside the Room, putting the parameter back', async () => {
    render('/rooms/room-1/documents?as=alice');
    const previewCache = probe.client as { clear: () => void };
    const clear = vi.spyOn(previewCache, 'clear');

    act(() => void probe.go!('/rooms/room-1/documents/doc-1#comment-c1'));

    await waitFor(() => expect(where()).toBe('/rooms/room-1/documents/doc-1?as=alice#comment-c1'));
    expect(view()).toBe('room-1:alice');
    expect(probe.client).toBe(previewCache);
    expect(clear).not.toHaveBeenCalled();
  });

  it('ends when leaving the Room, dropping the preview cache', () => {
    const { ownClient } = render('/rooms/room-1/documents?as=alice');
    const clear = vi.spyOn(probe.client as { clear: () => void }, 'clear');

    act(() => void probe.go!('/rooms/room-2/documents'));

    expect(view()).toBe('own');
    expect(viewAsUser()).toBeNull();
    expect(probe.client).toBe(ownClient);
    expect(clear).toHaveBeenCalled();
    expect(where()).toBe('/rooms/room-2/documents');
  });

  it('ends on a navigation that asks to exit, even inside the Room', () => {
    render('/rooms/room-1/documents/doc-1?as=alice');

    act(() => void probe.go!('/rooms/room-1/documents/doc-1', { state: { exitViewAs: true } }));

    expect(view()).toBe('own');
    expect(where()).toBe('/rooms/room-1/documents/doc-1');
  });

  it('switches to another member', () => {
    render('/rooms/room-1/documents?as=alice');

    act(() => void probe.go!('/rooms/room-1/documents?as=bob'));

    expect(view()).toBe('room-1:bob');
    expect(viewAsUser()).toBe('bob');
  });
});

describe('ViewAsBanner', () => {
  it('names the member in the header, which stays put, and exits to the same page', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ViewAsProvider>
        <AppHeader roomId="room-1" />
        <Probe />
      </ViewAsProvider>,
      { route: '/rooms/room-1/documents/doc-1?as=alice#comment-c1' },
    );

    expect(
      await screen.findByText('Stai vedendo la Stanza come Alice. Sola lettura.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status').closest('.app-header')).not.toHaveAttribute('data-hidden');

    await user.click(screen.getByRole('button', { name: 'Esci dalla vista' }));

    expect(view()).toBe('own');
    expect(where()).toBe('/rooms/room-1/documents/doc-1#comment-c1');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
