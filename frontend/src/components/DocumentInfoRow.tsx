import type { ReactNode } from 'react';
import { ActionIcon, Badge, Group, Popover, Text } from '@mantine/core';
import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { UserAvatar } from './UserAvatar';
import type { Member } from '../types/member';

// The label column of the Document info panel, so the rows' values line up.
const LABEL_WIDTH = 104;

/**
 * One row of the Document info panel: a dimmed label on the left and its
 * value (people, files, actions) beside it, wrapping under itself when long.
 */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group gap="xs" align="flex-start" wrap="nowrap">
      <Text size="xs" c="dimmed" w={LABEL_WIDTH} pt={4} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Group gap={6} style={{ flex: 1, minWidth: 0 }}>
        {children}
      </Group>
    </Group>
  );
}

/**
 * A member as a small pill with their avatar, plus a remove button when
 * `onRemove` is given (labeled by `removeLabel` for screen readers).
 */
export function PersonChip({
  member,
  name,
  onRemove,
  removeLabel,
}: {
  member: Member | undefined;
  name: string;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <Badge
      variant="outline"
      color="gray"
      tt="none"
      fw={500}
      maw="100%"
      pl={3}
      leftSection={<UserAvatar user={member} size={16} />}
      rightSection={
        onRemove ? (
          <ActionIcon size="xs" variant="transparent" color="gray" onClick={onRemove} aria-label={removeLabel}>
            <XIcon size={10} />
          </ActionIcon>
        ) : undefined
      }
    >
      {name}
    </Badge>
  );
}

/**
 * The small "+" that opens a compact form in a popover, instead of a form
 * always open under the row. The caller owns `opened`, to close it once done.
 */
export function AddPopover({
  label,
  opened,
  onChange,
  children,
}: {
  label: string;
  opened: boolean;
  onChange: (opened: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Popover opened={opened} onChange={onChange} position="bottom-start" withArrow shadow="md" width={300} trapFocus>
      <Popover.Target>
        <ActionIcon
          size="sm"
          variant="default"
          color="gray"
          aria-label={label}
          title={label}
          onClick={() => onChange(!opened)}
          style={{ borderStyle: 'dashed' }}
        >
          <PlusIcon size={12} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>{children}</Popover.Dropdown>
    </Popover>
  );
}
