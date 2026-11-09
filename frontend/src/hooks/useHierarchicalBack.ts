import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/apiClient';
import { backCandidates, backDestination, backTarget } from '../lib/backNav';
import { documentQuery } from './useDocuments';
import { sectionsQuery } from './useLanding';
import { mapQuery } from './useMaps';

/**
 * Whether the Document, map or Section at `path` can still be opened: read afresh (and
 * left in the cache for the page). Only a 404 - deleted, or hidden from the
 * viewer - says no (a Section: missing from the list); any other failure is left to the page to show.
 */
async function stillThere(queryClient: QueryClient, path: string): Promise<boolean> {
  const target = backTarget(path);
  if (!target) return true;
  try {
    if (target.kind === 'document') {
      await queryClient.fetchQuery({ ...documentQuery(target.roomId, target.documentId), staleTime: 0 });
    } else if (target.kind === 'section') {
      // The Sections come as one list: a Section deleted since is no longer in it.
      const sections = await queryClient.fetchQuery({ ...sectionsQuery(target.roomId), staleTime: 0 });
      return sections.some((section) => section.id === target.sectionId);
    } else {
      await queryClient.fetchQuery({ ...mapQuery(target.roomId, target.mapId), staleTime: 0 });
    }
    return true;
  } catch (error) {
    return !(error instanceof ApiError && error.status === 404);
  }
}

/**
 * The header's back arrow (`lib/backNav.ts`): where it goes first, and the
 * handler that goes to the nearest place on the trail still there, else to
 * the page's fixed parent `fallback`, the page arriving back at the scroll
 * position it was left at (`usePageScroll`). It replaces the current entry so back
 * and the browser's Back never ping-pong. A click while the checks are
 * still running does nothing, so a double click navigates once.
 */
export function useHierarchicalBack(fallback: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const going = useRef(false);

  const goBack = async () => {
    if (going.current) return;
    going.current = true;
    try {
      const candidates = backCandidates(location.state, fallback);
      for (const candidate of candidates.slice(0, -1)) {
        if (await stillThere(queryClient, candidate.path)) {
          void navigate(candidate.path, { replace: true, state: { ...candidate.state, restoreScroll: true } });
          return;
        }
      }
      void navigate(fallback, { replace: true, state: { restoreScroll: true } });
    } finally {
      // The header can stay mounted (one Document to another), so the next back works.
      going.current = false;
    }
  };

  return { destination: backDestination(location.state, fallback), goBack };
}
