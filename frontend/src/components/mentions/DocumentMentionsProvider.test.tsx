import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { useDocumentMentions } from '../../hooks/useDocumentMentions';
import { rawDocument, rawMember, rawRoom } from '../../test/fixtures';
import { renderHookWithProviders } from '../../test/utils';
import { DocumentMentionsProvider } from './DocumentMentionsProvider';
import type { ReactNode } from 'react';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

const tags = [{ id: 'tag-1', name: 'Luoghi', category: null }];
const routes: { members: unknown; room: unknown } = {
  members: [rawMember()],
  room: rawRoom(),
};

function mount(currentUserId = 'user-1') {
  return renderHookWithProviders(() => useDocumentMentions(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <DocumentMentionsProvider roomId="room-1" currentUserId={currentUserId}>
        {children}
      </DocumentMentionsProvider>
    ),
  });
}

beforeEach(() => {
  routes.members = [rawMember()];
  routes.room = rawRoom();
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    // The list returns an array, creating returns the one Document.
    if (path === '/rooms/room-1/documents') {
      return Promise.resolve(init?.method === 'POST' ? rawDocument() : [rawDocument()]);
    }
    if (path === '/rooms/room-1/tags') return Promise.resolve(tags);
    if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
    if (path === '/rooms/room-1') return Promise.resolve(routes.room);
    return Promise.resolve(rawDocument());
  });
});

describe('DocumentMentionsProvider', () => {
  it("exposes the Room's Documents and Tags", async () => {
    const { result } = mount();

    await waitFor(() => expect(result.current?.documents).toHaveLength(1));
    expect(result.current?.roomId).toBe('room-1');
    expect(result.current?.tags).toEqual(tags);
  });

  // Every consumer renders before the queries settle; empty lists keep the
  // popup harmless rather than crashing on undefined.
  it('starts with empty lists rather than undefined', () => {
    const { result } = mount();

    expect(result.current?.documents).toEqual([]);
    expect(result.current?.tags).toEqual([]);
  });

  it('creates a Document by name only, so the backend picks the default visibility', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current?.documents).toHaveLength(1));

    const created = await result.current!.create('document', 'Tempio');

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/documents', {
      method: 'POST',
      json: {
        name: 'Tempio',
        description: undefined,
        visibility: undefined,
        tag_ids: undefined,
        selective_user_ids: undefined,
      },
    });
    expect(created.kind).toBe('document');
  });

  it('creates a Tag with no category', async () => {
    fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === '/rooms/room-1/tags' && init?.method === 'POST') {
        return Promise.resolve({ id: 'tag-9', name: 'Tempio', category: null });
      }
      if (path === '/rooms/room-1/tags') return Promise.resolve(tags);
      if (path === '/rooms/room-1/documents') return Promise.resolve([rawDocument()]);
      if (path === '/rooms/room-1/members') return Promise.resolve(routes.members);
      return Promise.resolve(routes.room);
    });
    const { result } = mount();
    await waitFor(() => expect(result.current?.tags).toHaveLength(1));

    const created = await result.current!.create('tag', 'Tempio');

    expect(created).toEqual({
      kind: 'tag',
      tag: { id: 'tag-9', name: 'Tempio', category: null },
      documentCount: 0,
    });
  });
});

// The popup only offers what the backend would accept (D-13, and Tags are
// Administrator/Master only).
describe('what the viewer may create', () => {
  it('lets a Master create both', async () => {
    routes.members = [rawMember({ user_id: 'user-1', role: 'master' })];
    const { result } = mount();

    await waitFor(() => expect(result.current?.canCreateDocument).toBe(true));
    expect(result.current?.canCreateTag).toBe(true);
  });

  it('lets a Player create Documents when the Room allows it, but not Tags', async () => {
    routes.members = [rawMember({ user_id: 'user-1', role: 'player', is_admin: false })];
    routes.room = rawRoom({ players_can_create_documents: true });
    const { result } = mount();

    await waitFor(() => expect(result.current?.canCreateDocument).toBe(true));
    expect(result.current?.canCreateTag).toBe(false);
  });

  it('lets a Player create neither when the Room forbids Documents', async () => {
    routes.members = [rawMember({ user_id: 'user-1', role: 'player', is_admin: false })];
    routes.room = rawRoom({ players_can_create_documents: false });
    const { result, queryClient } = mount();

    await waitFor(() => expect(result.current?.documents).toHaveLength(1));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(result.current?.canCreateDocument).toBe(false);
    expect(result.current?.canCreateTag).toBe(false);
  });

  // Administrator is stackable on top of Player (D-11): it adds Tags on top
  // of whatever the Room already allows the Player to do.
  it('lets an Administrator Player create Tags', async () => {
    routes.members = [rawMember({ user_id: 'user-1', role: 'player', is_admin: true })];

    const { result, queryClient } = mount();

    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(result.current?.canCreateTag).toBe(true);
    expect(result.current?.canCreateDocument).toBe(true);
  });

  // Not a member of this Room (or the list hasn't arrived): create nothing.
  it('lets a non-member create nothing', async () => {
    const { result, queryClient } = mount('someone-else');

    await waitFor(() => expect(result.current?.documents).toHaveLength(1));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(result.current?.canCreateDocument).toBe(false);
    expect(result.current?.canCreateTag).toBe(false);
  });
});
