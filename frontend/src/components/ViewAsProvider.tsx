import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ViewAsContext, type ViewAs } from '../hooks/useViewAs';
import { VIEW_AS_PARAM, setViewAsUser } from '../lib/viewAs';

// The pages a preview covers: a Room's Documents and each Document.
const ROOM_PAGES = '/rooms/:roomId/documents/*';

/** Navigation state that ends a preview ("Exit" on the banner). */
export interface ExitViewAsState {
  exitViewAs: true;
}

/**
 * "View as" (spec 22b, FR-V3): while the URL of a Room's page carries
 * `?as=<user_id>`, the Master browses it as that member. Every request then
 * carries `X-View-As`, and the queries go to a **separate cache**, dropped
 * when the preview ends, so nothing seen as the member mixes with the
 * Master's own view. Following a link inside the same Room keeps the
 * preview (the parameter is put back on the URL); leaving the Room, or
 * navigating with `ExitViewAsState`, ends it.
 */
export function ViewAsProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const ownClient = useQueryClient();
  const roomId = matchPath(ROOM_PAGES, location.pathname)?.params.roomId ?? null;
  const fromUrl = new URLSearchParams(location.search).get(VIEW_AS_PARAM);
  const exiting = (location.state as Partial<ExitViewAsState> | null)?.exitViewAs === true;

  // The preview carried over from the previous page of the same Room.
  const [kept, setKept] = useState<ViewAs | null>(null);
  const viewRoomId = roomId && (fromUrl || (!exiting && kept?.roomId === roomId)) ? roomId : null;
  const viewUserId = viewRoomId ? (fromUrl ?? kept!.userId) : null;
  if (kept?.roomId !== (viewRoomId ?? undefined) || kept?.userId !== (viewUserId ?? undefined)) {
    setKept(viewRoomId && viewUserId ? { roomId: viewRoomId, userId: viewUserId } : null);
  }
  // Before any child queries: their requests must already carry the header.
  setViewAsUser(viewUserId);

  const viewAs = useMemo(
    () => (viewRoomId && viewUserId ? { roomId: viewRoomId, userId: viewUserId } : null),
    [viewRoomId, viewUserId],
  );
  const viewClient = useMemo(() => (viewAs ? new QueryClient() : null), [viewAs]);
  useEffect(() => () => viewClient?.clear(), [viewClient]);

  // A link inside the Room dropped the parameter: put it back.
  useEffect(() => {
    if (viewUserId && !fromUrl) {
      const search = new URLSearchParams(location.search);
      search.set(VIEW_AS_PARAM, viewUserId);
      void navigate(
        { pathname: location.pathname, search: `?${search}`, hash: location.hash },
        { replace: true },
      );
    }
  }, [viewUserId, fromUrl, location.pathname, location.search, location.hash, navigate]);

  return (
    <ViewAsContext value={viewAs}>
      <QueryClientProvider client={viewClient ?? ownClient}>{children}</QueryClientProvider>
    </ViewAsContext>
  );
}
