import type { ReactNode } from 'react';
import { Container, Stack } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { AppHeader } from './AppHeader';
import { SplitView } from './layout/SplitView';
import { DocumentSidePane } from './documents/DocumentSidePane';
import { SPLIT_QUERY, useSideDocument } from '../hooks/useSideDocument';

interface PageLayoutProps {
  backTo: string;
  backLabel: string;
  /** Given on a Room-scoped page, so `AppHeader` offers the Glossary Index
   *  toggle for this Room (spec 10), and a Document can open beside it
   *  (spec 37). */
  roomId?: string;
  /** The map pages: an empty `?side=` is the split open with no card picked yet (spec 37). */
  allowEmptySide?: boolean;
  children: ReactNode;
}

/**
 * The top bar - including the "back" button every nested page has, next to
 * the burger position (`AppHeader` owns its behaviour: it goes up the
 * hierarchy to `backTo`, not through browser history) - then a full-width page body with
 * side margins that grow with the screen, as the page's `main` landmark.
 * On a Room page whose address names a Document to open beside it
 * (`?side=`, spec 37), the body shares the width with that Document, on a
 * screen wide enough for both.
 */
export function PageLayout({ backTo, backLabel, roomId, allowEmptySide = false, children }: PageLayoutProps) {
  const { sideId, close } = useSideDocument();
  const wide = useMediaQuery(SPLIT_QUERY, true);
  const body = <Stack gap="md">{children}</Stack>;
  return (
    <>
      <AppHeader roomId={roomId} backTo={backTo} backLabel={backLabel} />
      <Container component="main" fluid px={{ base: 'sm', sm: 'lg', lg: 'xl' }} py="md">
        {roomId && (sideId || (allowEmptySide && sideId === '')) && wide ? (
          <SplitView left={body} right={<DocumentSidePane roomId={roomId} documentId={sideId || null} onClose={close} />} />
        ) : (
          body
        )}
      </Container>
    </>
  );
}
