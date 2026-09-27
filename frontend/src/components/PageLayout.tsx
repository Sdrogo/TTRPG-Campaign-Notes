import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
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
 * Whether there is an entry in *this app's own* browser history to go back
 * to. `window.history.state.idx` is set by the browser history React Router
 * (`BrowserRouter`) uses - `0` for the very first entry it created, so a
 * value greater than that means at least one in-app navigation happened
 * before this page.
 */
function hasAppHistory(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}

/**
 * The top bar, then a full-width page body with side margins that grow with
 * the screen, starting with the "back" button every nested page has. It
 * prefers real browser history - so it lands wherever the user actually came
 * from, not always the same fixed page - and falls back to `backTo` only
 * when there's no in-app entry behind this one (a bookmark, a shared link, a
 * fresh tab).
 */
export function PageLayout({ backTo, backLabel, roomId, children }: PageLayoutProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (hasAppHistory()) {
      navigate(-1);
    } else {
      navigate(backTo);
    }
  };

  return (
    <>
      <AppHeader roomId={roomId} />
      <Container fluid px={{ base: 'sm', sm: 'lg', lg: 'xl' }} py="md">
        <Stack gap="md">
          <Group>
            <Button onClick={handleBack} variant="subtle" leftSection={<ArrowLeftIcon size={16} />}>
              {backLabel}
            </Button>
          </Group>
          {children}
        </Stack>
      </Container>
    </>
  );
}
