import type { ReactNode } from 'react';
import { Group, Stack, Text, Title } from '@mantine/core';

interface PageHeadingProps {
  /** The page's name, its one `h1`. */
  title: ReactNode;
  /**
   * The small uppercase line above the title: on a Room's pages the Room's
   * name (its home page says "Home" there instead, since its title is the Room).
   */
  kicker?: ReactNode;
  /** Small controls right after the title (an edit switch, a fold toggle). */
  titleAfter?: ReactNode;
  /** A dimmed line under the title. */
  description?: ReactNode;
  /** The page's own actions, on the right; they wrap under the title on a phone. */
  actions?: ReactNode;
  /** A guided-tour target (spec 45_3) kept on the heading row. */
  'data-tour'?: string;
}

/**
 * Every page's heading row (spec 57c): optional kicker, the `h1` at the h2
 * size, optional description, the page's actions on the right, and a fine rule
 * underneath. It replaces the three hand-made variants the pages had (kicker +
 * rule, rule only, nothing), so all pages start the same way.
 */
export function PageHeading({
  title,
  kicker,
  titleAfter,
  description,
  actions,
  'data-tour': dataTour,
}: PageHeadingProps) {
  return (
    <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm" className="page-heading" data-tour={dataTour}>
      <Stack gap={2} style={{ minWidth: 0 }}>
        {kicker && (
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} className="page-heading-kicker">
            {kicker}
          </Text>
        )}
        <Group gap="sm" wrap="nowrap" align="center">
          <Title order={1} className="page-heading-title">
            {title}
          </Title>
          {titleAfter}
        </Group>
        {description && (
          <Text component="div" c="dimmed" size="sm" maw={720}>
            {description}
          </Text>
        )}
      </Stack>
      {actions && (
        <Group gap="xs" wrap="wrap" ml="auto" className="page-heading-actions">
          {actions}
        </Group>
      )}
    </Group>
  );
}
