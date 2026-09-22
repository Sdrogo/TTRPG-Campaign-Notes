import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';
import { toUserIdentity } from '../lib/profile';
import { supabase } from '../lib/supabaseClient';
import { isMembersQueryKey } from './useMembers';
import type { AccountProfile, ProfilePatch, RawUserIdentity } from '../types/profile';

interface RawAccount extends RawUserIdentity {
  user_id: string;
}

function toAccount(raw: RawAccount): AccountProfile {
  return { ...toUserIdentity(raw), userId: raw.user_id };
}

const ACCOUNT_QUERY_KEY = ['account'] as const;

export function useAccount(enabled: boolean) {
  return useQuery<AccountProfile>({
    queryKey: ACCOUNT_QUERY_KEY,
    queryFn: async () => toAccount(await apiFetch<RawAccount>('/account')),
    enabled,
  });
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

export function useUpdateProfile() {
  const applyAccount = useApplyAccount();
  return useMutation({
    mutationFn: async (patch: ProfilePatch) =>
      toAccount(await apiFetch<RawAccount>('/account', { method: 'PATCH', json: patch })),
    onSuccess: applyAccount,
  });
}

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

export function useRemoveAvatar() {
  const applyAccount = useApplyAccount();
  return useMutation({
    mutationFn: async () =>
      toAccount(await apiFetch<RawAccount>('/account/avatar', { method: 'DELETE' })),
    onSuccess: applyAccount,
  });
}

// Signs out and drops every cached response, so the next user signing in on
// this browser never sees the previous one's Rooms or profile.
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.clear();
      navigate('/');
    },
  });
}
