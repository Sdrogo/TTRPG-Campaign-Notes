import type { ReactNode } from 'react';
import { Card, Stack, Text, Title } from '@mantine/core';

interface AccountSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

// One titled card on the Account page (Profilo, Accesso, ...).
export function AccountSection({ title, description, children }: AccountSectionProps) {
  return (
    <Card withBorder radius="md" w="100%" p={{ base: 'md', sm: 'lg' }}>
      <Stack gap="md">
        <Stack gap={2}>
          <Title order={3} style={{ fontFamily: 'var(--font-display)' }}>
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
    </Card>
  );
}
