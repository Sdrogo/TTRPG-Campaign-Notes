import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { CurrentUser } from '../types/auth';

export function useCurrentUser(enabled: boolean) {
  return useQuery<CurrentUser>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiFetch<CurrentUser>('/auth/me'),
    enabled,
    retry: false,
  });
}
