import type { ReactNode } from 'react';
import { Stack, Text, Title } from '@mantine/core';
import { PageCard } from '../PageCard';

interface AccountSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

// One titled card on the Account page (Profilo, Accesso, ...).
export function AccountSection({ title, description, children }: AccountSectionProps) {
  return (
    <PageCard>
      <Stack gap="md">
        <Stack gap={2}>
          <Title order={2} fz="h3" style={{ fontFamily: 'var(--font-display)' }}>
            {title}
          </Title>
          {description && (
            <Text size="sm" c="dimmed">
              {description}
            </Text>
          )}
        </Stack>
        {children}
      </Stack>
    </PageCard>
  );
}
