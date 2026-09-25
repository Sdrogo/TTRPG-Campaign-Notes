import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Loader, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

// Full-viewport placeholders shared by every routed page: loading, and a
// message with an optional way out (sign in, go back, ...).

/** A centered spinner while a page's session or data loads. */
export function FullPageLoader() {
  return (
    <Stack align="center" justify="center" style={{ minHeight: '100svh' }}>
      <Loader color="accent" />
    </Stack>
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
    <Stack align="center" justify="center" gap="md" p="md" style={{ minHeight: '100svh' }}>
      <Text ta="center">{children}</Text>
      {actionLabel && actionTo && (
        <Button component={Link} to={actionTo}>
          {actionLabel}
        </Button>
      )}
    </Stack>
  );
}

/** The message for a signed-out visitor, with a link to the sign-in page. */
export function SignInRequired({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <FullPageMessage actionLabel={t('common.goToLogin')} actionTo="/">
      {children}
    </FullPageMessage>
  );
}
