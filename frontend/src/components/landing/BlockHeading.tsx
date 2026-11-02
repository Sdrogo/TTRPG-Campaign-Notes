import type { ReactNode } from 'react';
import { Badge, Group, Text, Title, UnstyledButton } from '@mantine/core';
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react';

interface BlockHeadingProps {
  label: ReactNode;
  /** Cards under it; no badge when undefined. */
  count?: number;
  expanded: boolean;
  onToggle: () => void;
  /** Heading level: 2 on a Section and on the Documents page. */
  order?: 2 | 3;
  /** Before the toggle, e.g. a drag handle in edit mode. */
  leading?: ReactNode;
  /** After the toggle, e.g. a block's actions. */
  trailing?: ReactNode;
}

/**
 * The heading of a block (spec 60 Decision 9): a caret, the name in the
 * display font and the count, one button that folds the block. The same
 * component draws a Section's blocks and the Documents page's groups
 * (Decision 14), so the two pages can't drift apart.
 */
export function BlockHeading({ label, count, expanded, onToggle, order = 2, leading, trailing }: BlockHeadingProps) {
  return (
    <Group gap={4} wrap="nowrap" className="block-heading">
      {leading}
      <Title order={order} fz="h4" style={{ fontFamily: 'var(--font-display)', minWidth: 0 }}>
        <UnstyledButton onClick={onToggle} aria-expanded={expanded} className="block-heading-toggle">
          {expanded ? <CaretDownIcon size={18} aria-hidden="true" /> : <CaretRightIcon size={18} aria-hidden="true" />}
          <Text component="span" inherit>
            {label}
          </Text>
          {count !== undefined && (
            <Badge size="sm" variant="light" color="gray" circle aria-hidden="true">
              {count}
            </Badge>
          )}
        </UnstyledButton>
      </Title>
      {trailing}
    </Group>
  );
}
