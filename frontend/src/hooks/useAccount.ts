import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiDownload, apiFetch } from '../lib/apiClient';
import { DELETION_CONFIRMATION, personalDataFileName } from '../lib/privacy';
import { saveBlob } from '../lib/roomExport';
import { toUserIdentity } from '../lib/profile';
import {
  applyPalette,
  currentPalette,
  paletteFromApi,
  paletteToApi,
  type ColorPalette,
} from '../lib/palette';
import { forgetSession, signOut } from '../lib/auth';
import { isMembersQueryKey } from './useMembers';
import type { AccountProfile, ProfilePatch, RawUserIdentity } from '../types/profile';

interface RawAccount extends RawUserIdentity {
  user_id: string;
  app_admin?: boolean;
  color_palette?: string | null;
}

function toAccount(raw: RawAccount): AccountProfile {
  return {
    ...toUserIdentity(raw),
    userId: raw.user_id,
    appAdmin: raw.app_admin === true,
    colorPalette: paletteFromApi(raw.color_palette),
  };
}

const ACCOUNT_QUERY_KEY = ['account'] as const;

/** The signed-in user's profile. The backend fills in Google defaults on the first call. */
export function useAccount(enabled: boolean) {
  const query = useQuery<AccountProfile>({
    queryKey: ACCOUNT_QUERY_KEY,
    queryFn: async () => toAccount(await apiFetch<RawAccount>('/account')),
    enabled,
  });
  // The account's palette wins over the one this browser remembered (spec 78).
  const palette = query.data?.colorPalette;
  useEffect(() => {
    if (palette && palette !== currentPalette()) applyPalette(palette);
  }, [palette]);
  return query;
}

// Every profile change returns the whole profile: store it, and refresh the
// member lists that show this user's name and avatar to others.
function useApplyAccount() {
  const queryClient = useQueryClient();
  return (account: AccountProfile) => {
    queryClient.setQueryData(ACCOUNT_QUERY_KEY, account);
    void queryClient.invalidateQueries({ predicate: (query) => isMembersQueryKey(query.queryKey) });
  };
}

/** Saves the profile form. Blank fields clear on the backend. */
export function useUpdateProfile() {
  const applyAccount = useApplyAccount();
  return useMutation({
    mutationFn: async (patch: ProfilePatch) =>
      toAccount(await apiFetch<RawAccount>('/account', { method: 'PATCH', json: patch })),
    onSuccess: applyAccount,
  });
}

/**
 * Saves the map palette (spec 78). It is drawn at once and put back if the
 * save fails.
 */
export function useUpdateColorPalette() {
  const applyAccount = useApplyAccount();
  return useMutation({
    mutationFn: async (palette: ColorPalette) =>
      toAccount(
        await apiFetch<RawAccount>('/account', {
          method: 'PATCH',
          json: { color_palette: paletteToApi(palette) },
        }),
      ),
    onMutate: (palette) => {
      const previous = currentPalette();
      applyPalette(palette);
      return { previous };
    },
    onError: (_error, palette, context) => {
      // Only when nothing was picked since: a later pick stays drawn.
      if (context && currentPalette() === palette) applyPalette(context.previous);
    },
    onSuccess: applyAccount,
  });
}

/** Replaces the avatar with an uploaded file. */
export function useUploadAvatar() {
  const applyAccount = useApplyAccount();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return toAccount(await apiFetch<RawAccount>('/account/avatar', { method: 'POST', formData }));
    },
    onSuccess: applyAccount,
  });
}

/** Replaces the avatar with an image fetched from a URL. */
export function useImportAvatar() {
  const applyAccount = useApplyAccount();
  return useMutation({
    mutationFn: async (url: string) =>
      toAccount(
        await apiFetch<RawAccount>('/account/avatar/from-url', { method: 'POST', json: { url } }),
      ),
    onSuccess: applyAccount,
  });
}

/** Removes the avatar, so the user is shown by initials. */
export function useRemoveAvatar() {
  const applyAccount = useApplyAccount();
  return useMutation({
    mutationFn: async () =>
      toAccount(await apiFetch<RawAccount>('/account/avatar', { method: 'DELETE' })),
    onSuccess: applyAccount,
  });
}

/**
 * Signs out and drops every cached response, so the next user signing in on
 * this browser never sees the previous one's Rooms or profile.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      navigate('/');
    },
  });
}

/** Downloads everything the app keeps about the signed-in user as JSON (spec 31_2, GDPR art. 15 and 20). */
export function useExportPersonalData() {
  return useMutation({
    mutationFn: async () => {
      const blob = await apiDownload('/account/export');
      saveBlob(blob, personalDataFileName(new Date()));
    },
  });
}

/**
 * Permanently deletes the signed-in user's account (spec 31_1, GDPR art. 17),
 * then forgets the session on this device and every cached response. The
 * backend has already ended every session of the account, so nothing is
 * left to sign out of there.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      await apiFetch<void>('/account', {
        method: 'DELETE',
        json: { confirmation: DELETION_CONFIRMATION },
      });
      forgetSession();
    },
    onSuccess: () => {
      queryClient.clear();
      navigate('/');
    },
  });
}
