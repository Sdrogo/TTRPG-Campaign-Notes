import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Container, Group, Stack } from '@mantine/core';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { AppHeader } from './AppHeader';

interface PageLayoutProps {
  backTo: string;
  backLabel: string;
  children: ReactNode;
}

/**
 * The top bar, then a full-width page body with side margins that grow with the
 * screen, starting with the "back" link every nested page has.
 */
export function PageLayout({ backTo, backLabel, children }: PageLayoutProps) {
  return (
    <>
      <AppHeader />
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
