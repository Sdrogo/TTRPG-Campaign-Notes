import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Container, Group, Stack } from '@mantine/core';
import { ArrowLeftIcon } from '@phosphor-icons/react';
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
 * The top bar, then a full-width page body with side margins that grow with the
 * screen, starting with the "back" link every nested page has.
 */
export function PageLayout({ backTo, backLabel, roomId, children }: PageLayoutProps) {
  return (
    <>
      <AppHeader roomId={roomId} />
      <Container fluid px={{ base: 'sm', sm: 'lg', lg: 'xl' }} py="md">
        <Stack gap="md">
          <Group>
            <Button
              component={Link}
              to={backTo}
              variant="subtle"
              leftSection={<ArrowLeftIcon size={16} />}
            >
              {backLabel}
            </Button>
          </Group>
          {children}
        </Stack>
      </Container>
    </>
  );
}
