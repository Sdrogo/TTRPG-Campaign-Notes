import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/apiClient';
import { setViewAsUser } from '../../lib/viewAs';
import { rawPdfJob } from '../fixtures';
import { renderHookWithProviders } from '../utils';
import {
  pdfExportsQueryKey,
  useDismissedPdfJobs,
  usePdfExports,
  useStartPdfExport,
} from '../../hooks/usePdfExports';
import { DEFAULT_PDF_OPTIONS } from '../../lib/pdfExport';

vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  setViewAsUser(null);
  localStorage.clear();
});

describe('usePdfExports', () => {
  it("reads the user's own jobs, never as the member being previewed", async () => {
    fetchMock.mockResolvedValue([
      rawPdfJob({ status: 'done', download_url: 'https://signed.test/a.pdf' }),
    ]);

    const { result } = renderHookWithProviders(() => usePdfExports('room-1', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/exports', { ignoreViewAs: true });
    expect(result.current.data?.[0]).toMatchObject({
      id: 'job-1',
      status: 'done',
      pageSize: 'A4',
      downloadUrl: 'https://signed.test/a.pdf',
    });
  });

  it('does not fetch while disabled', () => {
    renderHookWithProviders(() => usePdfExports('room-1', false));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads again every few seconds while a job is being made', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchMock
        .mockResolvedValueOnce([rawPdfJob({ status: 'running' })])
        .mockResolvedValue([rawPdfJob({ status: 'done', download_url: 'https://x/a.pdf' })]);

      const { result } = renderHookWithProviders(() => usePdfExports('room-1', true));
      await waitFor(() => expect(result.current.data?.[0].status).toBe('running'));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });

      await waitFor(() => expect(result.current.data?.[0].status).toBe('done'));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useStartPdfExport', () => {
  it('posts the choices and reloads the job list', async () => {
    fetchMock.mockResolvedValue(rawPdfJob());
    const { result, queryClient } = renderHookWithProviders(() => useStartPdfExport('room-1'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({ ...DEFAULT_PDF_OPTIONS, style: 'modern', tagIds: ['t1'] });
    });

    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/exports/pdf', {
      method: 'POST',
      json: {
        style: 'modern',
        page_size: 'A4',
        include_comments: false,
        include_attachments: false,
        cover_document_id: null,
        tag_ids: ['t1'],
        view_as_user_id: null,
      },
      ignoreViewAs: true,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: pdfExportsQueryKey('room-1') });
    await waitFor(() =>
      expect(result.current.data).toMatchObject({ id: 'job-1', status: 'queued' }),
    );
  });

  it('names the member being previewed in the body, not in the header (spec 22b)', async () => {
    fetchMock.mockResolvedValue(rawPdfJob());
    setViewAsUser('alice');
    const { result } = renderHookWithProviders(() => useStartPdfExport('room-1'));

    await act(async () => {
      await result.current.mutateAsync(DEFAULT_PDF_OPTIONS);
    });

    const init = fetchMock.mock.calls[0][1] as { json: { view_as_user_id: string } };
    expect(init.json.view_as_user_id).toBe('alice');
  });
});

describe('useDismissedPdfJobs', () => {
  it('starts from what the browser remembers and shares a new dismissal', async () => {
    localStorage.setItem('pdfDismissed:user-1:room-1', '["old"]');

    const { result } = renderHookWithProviders(() => useDismissedPdfJobs('user-1', 'room-1'));
    await waitFor(() => expect(result.current.dismissed.has('old')).toBe(true));

    act(() => result.current.dismiss('new'));

    await waitFor(() => expect([...result.current.dismissed]).toEqual(['old', 'new']));
    expect(JSON.parse(localStorage.getItem('pdfDismissed:user-1:room-1') ?? '[]')).toEqual([
      'old',
      'new',
    ]);
  });

  it('is empty before the browser has answered', () => {
    const { result } = renderHookWithProviders(() => useDismissedPdfJobs('user-1', 'room-1'));

    expect(result.current.dismissed.size).toBe(0);
  });
});
