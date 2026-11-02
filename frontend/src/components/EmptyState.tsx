import type { ReactNode } from 'react';
import { Card, Stack, Text, ThemeIcon } from '@mantine/core';

interface EmptyStateProps {
  /** A Phosphor icon, `duotone` at 28px, shown in a quiet grey tile. */
  icon: ReactNode;
  /** What is missing and, if anything, what to do about it. */
  children: ReactNode;
  /** An optional button under the text. */
  action?: ReactNode;
}

/**
 * The one "nothing here yet" block of every list page (spec 57c), on the model
 * of the Maps page's: a dashed, transparent card with an icon over a dimmed
 * line of text.
 */
export function EmptyState({ icon, children, action }: EmptyStateProps) {
  return (
    <Card withBorder radius="md" p="xl" className="empty-state">
      <Stack align="center" gap="md">
        <ThemeIcon variant="light" color="gray" size="xl" radius="md" aria-hidden="true">
          {icon}
        </ThemeIcon>
        <Text c="dimmed" ta="center">
          {children}
        </Text>
        {action}
      </Stack>
    </Card>
  );
}
