import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Loader, Stack, Text } from '@mantine/core';

// Full-viewport placeholders shared by every routed page: loading, and a
// message with an optional way out (sign in, go back, ...).

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

export function SignInRequired({ children }: { children: ReactNode }) {
  return (
    <FullPageMessage actionLabel="Vai al login" actionTo="/">
      {children}
    </FullPageMessage>
  );
}
