import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { AdminStats } from '../types/admin';

/**
 * The Admin page's numbers (ticket 75). The backend answers 404 to anyone
 * not listed in `ADMIN_USER_IDS`, so that error is not retried.
 */
export function useAdminStats(enabled: boolean) {
  return useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: () => apiFetch<AdminStats>('/admin/stats'),
    enabled,
    retry: false,
  });
}
