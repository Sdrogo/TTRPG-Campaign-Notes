import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Center, Loader, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

// Full-viewport placeholders shared by every routed page: loading, and a
// message with an optional way out (sign in, go back, ...).

/** A centered spinner while a page's session or data loads. */
export function FullPageLoader() {
  return (
    <Stack component="main" align="center" justify="center" style={{ minHeight: '100svh' }}>
      <Loader color="accent" />
    </Stack>
  );
}

/**
 * A spinner for data still loading inside a page that is already drawn (a
 * Room's Documents, its maps, the setup's Tags...): centered in the page's
 * width with room above and below, like the full-page one, instead of sitting
 * in the top-left corner under the heading (spec 57c, product owner 2026-11-02).
 */
export function SectionLoader() {
  return (
    <Center py={48} w="100%">
      <Loader color="accent" />
    </Center>
  );
}

interface FullPageMessageProps {
  children: ReactNode;
  actionLabel?: string;
  actionTo?: string;
}

/** A centered message, with a link out when `actionLabel` and `actionTo` are given. */
export function FullPageMessage({ children, actionLabel, actionTo }: FullPageMessageProps) {
  return (
    <Stack component="main" align="center" justify="center" gap="md" p="md" style={{ minHeight: '100svh' }}>
      <Text ta="center">{children}</Text>
      {actionLabel && actionTo && (
        <Button component={Link} to={actionTo}>
          {actionLabel}
        </Button>
      )}
    </Stack>
  );
}

/** The message for a signed-out visitor, with a link to the landing page's sign-in block. */
export function SignInRequired({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <FullPageMessage actionLabel={t('common.goToLogin')} actionTo="/#sign-in">
      {children}
    </FullPageMessage>
  );
}
