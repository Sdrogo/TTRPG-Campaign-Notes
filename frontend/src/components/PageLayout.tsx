import type { ReactNode } from 'react';
import { Container, Stack } from '@mantine/core';
import { AppHeader } from './AppHeader';

interface PageLayoutProps {
  backTo: string;
  backLabel: string;
  /** Given on a Room-scoped page, so `AppHeader` offers the Glossary Index
   *  toggle for this Room (spec 10). */
  roomId?: string;
  children: ReactNode;
}

/**
 * The top bar - including the "back" button every nested page has, next to
 * the burger position (`AppHeader` owns its behaviour: it prefers real
 * browser history over the fixed `backTo`) - then a full-width page body with
 * side margins that grow with the screen, as the page's `main` landmark.
 */
export function PageLayout({ backTo, backLabel, roomId, children }: PageLayoutProps) {
  return (
    <>
      <AppHeader roomId={roomId} backTo={backTo} backLabel={backLabel} />
      <Container component="main" fluid px={{ base: 'sm', sm: 'lg', lg: 'xl' }} py="md">
        <Stack gap="md">{children}</Stack>
      </Container>
    </>
  );
}
