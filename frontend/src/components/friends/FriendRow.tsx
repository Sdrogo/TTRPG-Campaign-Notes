import type { ReactNode } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { UserAvatar } from '../UserAvatar';
import { userDisplayName } from '../../lib/members';
import type { UserIdentity } from '../../types/profile';

interface FriendRowProps {
  user: UserIdentity;
  /** A second line under the name; defaults to the user's pronouns. */
  detail?: ReactNode;
  /** The row's buttons, on the right. */
  children?: ReactNode;
}

/**
 * One person in a Friends list or invitation: avatar, name and the actions
 * for them. Another user's email is never sent (NFR-03).
 */
export function FriendRow({ user, detail, children }: FriendRowProps) {
  const name = userDisplayName(user);
  return (
    <Group justify="space-between" wrap="wrap" gap="sm">
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
        <UserAvatar user={user} size="md" />
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
            {name}
          </Text>
          {detail ??
            (user.pronouns && (
              <Text size="xs" c="dimmed">
                {user.pronouns}
              </Text>
            ))}
        </Stack>
      </Group>
      {children && (
        <Group gap="xs" wrap="nowrap">
          {children}
        </Group>
      )}
    </Group>
  );
}
