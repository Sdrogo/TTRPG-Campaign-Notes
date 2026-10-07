import type { ReactNode } from 'react';
import { Box, Group } from '@mantine/core';

interface CompactListProps {
  /** `ol` when the order means something (the Main items), `ul` otherwise. */
  component?: 'ul' | 'ol';
  /**
   * Lays the rows out in as many columns of at least this many pixels as fit,
   * so on a wide screen a row never grows far wider than its content (spec 25
   * Decision 4). Omitted, the rows are one column.
   */
  columnWidth?: number;
  /** The rows: `CompactListItem`s. */
  children: ReactNode;
}

/**
 * A list of simple items as one bordered box with thin dividers between rows,
 * instead of one boxed row per item (spec 25 Decision 3). The dividers are each
 * row's top border pulled up by a pixel, so the box clips the first row's (and,
 * in columns, the first line's) and every layout gets the same lines.
 */
export function CompactList({ component = 'ul', columnWidth, children }: CompactListProps) {
  return (
    <Box
      component={component}
      className="compact-list"
      p={0}
      m={0}
      style={
        columnWidth
          ? {
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill, minmax(min(${columnWidth}px, 100%), 1fr))`,
              columnGap: 'var(--mantine-spacing-lg)',
            }
          : undefined
      }
    >
      {children}
    </Box>
  );
}

interface CompactListItemProps {
  /** Before the label: a position, an icon. */
  leading?: ReactNode;
  /** The row's actions, right after the label. */
  actions?: ReactNode;
  /** Pushes the actions to the row's end instead of right after the label. */
  actionsAtEnd?: boolean;
  /** The row's main content. */
  children: ReactNode;
}

/** One row of a `CompactList`: about 36px tall, its actions next to what they act on. */
export function CompactListItem({
  leading,
  actions,
  actionsAtEnd,
  children,
}: CompactListItemProps) {
  return (
    <Box component="li" className="compact-list-item">
      <Group gap="xs" wrap="nowrap" mih={36} px="sm" py={4}>
        {leading}
        <Box style={{ minWidth: 0, flex: actionsAtEnd ? 1 : '0 1 auto' }}>{children}</Box>
        {actions && (
          <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
            {actions}
          </Group>
        )}
      </Group>
    </Box>
  );
}
