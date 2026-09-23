import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../lib/apiClient';
import { supabase } from '../lib/supabaseClient';
import { rawAccount } from '../test/fixtures';
import { renderHookWithProviders } from '../test/utils';
import {
  useAccount,
  useImportAvatar,
  useRemoveAvatar,
  useSignOut,
  useUpdateProfile,
  useUploadAvatar,
} from './useAccount';

vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const fetchMock = vi.mocked(apiFetch);
const signOut = vi.mocked(supabase.auth.signOut);

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  signOut.mockReset();
});

describe('useAccount', () => {
  it('maps the account profile', async () => {
    fetchMock.mockResolvedValue(rawAccount({ pronouns: 'lei', avatar_url: 'http://a/v.webp' }));

    const { result } = renderHookWithProviders(() => useAccount(true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/account');
    expect(result.current.data).toEqual({
      userId: 'user-1',
      email: 'io@example.com',
      displayName: 'Io',
      pronouns: 'lei',
      bio: null,
      avatarUrl: 'http://a/v.webp',
    });
  });

  it('does not fetch while disabled', () => {
    renderHookWithProviders(() => useAccount(false));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useUpdateProfile', () => {
  it('patches the account with the raw patch body', async () => {
    fetchMock.mockResolvedValue(rawAccount({ display_name: 'Nuovo' }));

    const { result } = renderHookWithProviders(() => useUpdateProfile());
    await result.current.mutateAsync({ display_name: 'Nuovo', pronouns: null, bio: null });

    expect(fetchMock).toHaveBeenCalledWith('/account', {
      method: 'PATCH',
      json: { display_name: 'Nuovo', pronouns: null, bio: null },
    });
  });

  // The response is the whole profile, so it's written straight into the
  // cache rather than refetched.
  it('writes the returned profile into the account cache', async () => {
    fetchMock.mockResolvedValue(rawAccount({ display_name: 'Nuovo' }));
    const { result, queryClient } = renderHookWithProviders(() => useUpdateProfile());

    await result.current.mutateAsync({ display_name: 'Nuovo', pronouns: null, bio: null });

    await waitFor(() =>
      expect(queryClient.getQueryData(['account'])).toMatchObject({ displayName: 'Nuovo' }),
    );
  });

  // Other members see this user's name and avatar in every Room they share.
  it('invalidates every member list, and nothing else', async () => {
    fetchMock.mockResolvedValue(rawAccount());
    const { result, queryClient } = renderHookWithProviders(() => useUpdateProfile());
    queryClient.setQueryData(['rooms', 'room-1', 'members'], []);
    queryClient.setQueryData(['rooms', 'room-1', 'documents'], []);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync({ display_name: 'Io', pronouns: null, bio: null });

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const predicate = invalidate.mock.calls[0]?.[0]?.predicate;
    expect(predicate?.({ queryKey: ['rooms', 'room-1', 'members'] } as never)).toBe(true);
    expect(predicate?.({ queryKey: ['rooms', 'room-1', 'documents'] } as never)).toBe(false);
  });
});

describe('avatar mutations', () => {
  it('uploads an avatar as multipart', async () => {
    fetchMock.mockResolvedValue(rawAccount());

    const { result } = renderHookWithProviders(() => useUploadAvatar());
    await result.current.mutateAsync(new File(['bytes'], 'me.png', { type: 'image/png' }));

    const [path, init] = fetchMock.mock.calls[0] as [string, { formData: FormData }];
    expect(path).toBe('/account/avatar');
    expect((init.formData.get('file') as File).name).toBe('me.png');
  });

  it('imports an avatar from a URL', async () => {
    fetchMock.mockResolvedValue(rawAccount());

    const { result } = renderHookWithProviders(() => useImportAvatar());
    await result.current.mutateAsync('https://example.com/me.png');

    expect(fetchMock).toHaveBeenCalledWith('/account/avatar/from-url', {
      method: 'POST',
      json: { url: 'https://example.com/me.png' },
    });
  });

  it('removes an avatar and stores the profile that comes back', async () => {
    fetchMock.mockResolvedValue(rawAccount({ avatar_url: null }));
    const { result, queryClient } = renderHookWithProviders(() => useRemoveAvatar());

    await result.current.mutateAsync();

    expect(fetchMock).toHaveBeenCalledWith('/account/avatar', { method: 'DELETE' });
    await waitFor(() =>
      expect(queryClient.getQueryData(['account'])).toMatchObject({ avatarUrl: null }),
    );
  });
});

describe('useSignOut', () => {
  // Cached Rooms and profiles belong to the user who just left; the next
  // person signing in on this browser must not see them.
  it('clears the whole cache and returns home', async () => {
    signOut.mockResolvedValue({ error: null } as Awaited<ReturnType<typeof supabase.auth.signOut>>);
    const { result, queryClient } = renderHookWithProviders(() => useSignOut());
    queryClient.setQueryData(['rooms'], [{ id: 'room-1' }]);

    await result.current.mutateAsync();

    await waitFor(() => {
      expect(queryClient.getQueryData(['rooms'])).toBeUndefined();
      expect(navigate).toHaveBeenCalledWith('/');
    });
  });

  it('throws when Supabase refuses to sign out, leaving the cache alone', async () => {
    signOut.mockResolvedValue({ error: new Error('network') } as unknown as Awaited<
      ReturnType<typeof supabase.auth.signOut>
    >);
    const { result, queryClient } = renderHookWithProviders(() => useSignOut());
    queryClient.setQueryData(['rooms'], [{ id: 'room-1' }]);

    await expect(result.current.mutateAsync()).rejects.toThrow('network');
    expect(queryClient.getQueryData(['rooms'])).toEqual([{ id: 'room-1' }]);
    expect(navigate).not.toHaveBeenCalled();
  });
});
