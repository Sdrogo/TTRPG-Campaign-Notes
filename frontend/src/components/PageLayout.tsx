import { useEffect, useRef, type ReactNode } from 'react';
import { Box, Container, Stack } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { AppHeader } from './AppHeader';
import { RoomIndex, type RoomIndexContext } from './RoomIndex';
import { SplitView } from './layout/SplitView';
import { DocumentSidePane } from './documents/DocumentSidePane';
import { isPlaceSide, SPLIT_QUERY, useSideDocument } from '../hooks/useSideDocument';

interface PageLayoutProps {
  backTo: string;
  backLabel: string;
  /** Given on a Room-scoped page, so `AppHeader` offers the Room's search
   *  and a Document can open beside it (spec 37). */
  roomId?: string;
  /** The Room's Index tab on the left edge (`RoomIndex`, spec 44): the
   *  landing, its Sections and the Documents and Maps pages show it (spec 55
   *  Decision 10; not the Session 0 board, spec 46c Decision 1). */
  showIndex?: boolean;
  /** What the page on screen adds to the Index: the Section it is, and a custom Section's blocks. */
  index?: RoomIndexContext;
  /**
   * The map pages: an empty `?side=` is the split open with no card picked
   * yet (spec 37), and on a phone a picked Document opens in the lower half
   * of the screen, under the map.
   */
  allowEmptySide?: boolean;
  /**
   * What the split shows for a `?side=` value that is not a Document's (a
   * geographic map's place, spec 50), or null to show the Document. A place
   * value on a page without it counts as no pane.
   */
  renderSide?: (sideId: string) => ReactNode | null;
  children: ReactNode;
}

/**
 * The top bar - including the "back" button every nested page has
 * (`AppHeader` owns its behaviour: it goes up the hierarchy to `backTo`, not
 * through browser history) -, on the Room's Documents page the Index tab on
 * the left edge (spec 44), then a full-width page body with
 * side margins that grow with the screen, as the page's `main` landmark.
 * On a Room page whose address names a Document to open beside it
 * (`?side=`, spec 37), the body shares the width with that Document, on a
 * screen wide enough for both; on a phone, a map page shows it in the lower
 * half of the screen instead, the page scrolling above it.
 */
export function PageLayout({
  backTo,
  backLabel,
  roomId,
  showIndex = false,
  index,
  allowEmptySide = false,
  renderSide,
  children,
}: PageLayoutProps) {
  const side = useSideDocument();
  const { close } = side;
  const custom = side.sideId && renderSide ? renderSide(side.sideId) : null;
  const sideId = isPlaceSide(side.sideId) && !custom ? null : side.sideId;
  const pane = (documentId: string | null) =>
    custom ?? <DocumentSidePane roomId={roomId!} documentId={documentId} onClose={close} />;
  const wide = useMediaQuery(SPLIT_QUERY, true);
  const below = Boolean(roomId && allowEmptySide && sideId && !wide);
  const page = useRef<HTMLDivElement>(null);
  const withIndex = Boolean(roomId && showIndex);
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
      {withIndex && <RoomIndex roomId={roomId!} {...index} />}
      {/* With the Index tab on the left edge the page keeps clear of it (spec 57):
          the tab used to cover the first letters of the title on a phone. */}
      <Container
        component="main"
        fluid
        pl={withIndex ? { base: 40, sm: 48 } : { base: 'sm', sm: 'lg', lg: 'xl' }}
        pr={{ base: 'sm', sm: 'lg', lg: 'xl' }}
        py="md"
      >
        {roomId && (sideId || (allowEmptySide && sideId === '')) && wide ? (
          <SplitView left={body} right={pane(sideId || null)} />
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
            {pane(sideId)}
          </Box>
        )}
      </Container>
    </>
  );
}
