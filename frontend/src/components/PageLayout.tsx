import { useEffect, useRef, type ReactNode } from 'react';
import { Box, Container, Stack } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { AppHeader } from './AppHeader';
import { RoomIndex } from './RoomIndex';
import { SplitView } from './layout/SplitView';
import { DocumentSidePane } from './documents/DocumentSidePane';
import { SPLIT_QUERY, useSideDocument } from '../hooks/useSideDocument';

interface PageLayoutProps {
  backTo: string;
  backLabel: string;
  /** Given on a Room-scoped page, so the Room's Index tab sits on the left
   *  edge (`RoomIndex`, spec 44), `AppHeader` offers the Room's search, and a
   *  Document can open beside it (spec 37). */
  roomId?: string;
  /**
   * The map pages: an empty `?side=` is the split open with no card picked
   * yet (spec 37), and on a phone a picked Document opens in the lower half
   * of the screen, under the map.
   */
  allowEmptySide?: boolean;
  children: ReactNode;
}

/**
 * The top bar - including the "back" button every nested page has
 * (`AppHeader` owns its behaviour: it goes up the hierarchy to `backTo`, not
 * through browser history) -, on a Room page the Index tab on the left edge
 * (spec 44), then a full-width page body with
 * side margins that grow with the screen, as the page's `main` landmark.
 * On a Room page whose address names a Document to open beside it
 * (`?side=`, spec 37), the body shares the width with that Document, on a
 * screen wide enough for both; on a phone, a map page shows it in the lower
 * half of the screen instead, the page scrolling above it.
 */
export function PageLayout({ backTo, backLabel, roomId, allowEmptySide = false, children }: PageLayoutProps) {
  const { sideId, close } = useSideDocument();
  const wide = useMediaQuery(SPLIT_QUERY, true);
  const below = Boolean(roomId && allowEmptySide && sideId && !wide);
  const page = useRef<HTMLDivElement>(null);
  // Opening the lower half brings the map (`data-split-anchor`) to the top of the screen.
  useEffect(() => {
    if (below) page.current!.querySelector('[data-split-anchor]')?.scrollIntoView({ block: 'start' });
  }, [below]);
  const body = (
    <Stack ref={page} gap="md" pb={below ? '50dvh' : undefined}>
      {children}
    </Stack>
  );
  return (
    <>
      <AppHeader roomId={roomId} backTo={backTo} backLabel={backLabel} />
      {roomId && <RoomIndex roomId={roomId} />}
      <Container component="main" fluid px={{ base: 'sm', sm: 'lg', lg: 'xl' }} py="md">
        {roomId && (sideId || (allowEmptySide && sideId === '')) && wide ? (
          <SplitView left={body} right={<DocumentSidePane roomId={roomId} documentId={sideId || null} onClose={close} />} />
        ) : (
          body
        )}
        {below && (
          <Box
            pos="fixed"
            left={0}
            right={0}
            bottom={0}
            h="50dvh"
            px="sm"
            bg="var(--bg-base)"
            style={{ zIndex: 150, overflowY: 'auto', borderTop: '1px solid var(--border-default)' }}
          >
            <DocumentSidePane roomId={roomId!} documentId={sideId} onClose={close} />
          </Box>
        )}
      </Container>
    </>
  );
}
