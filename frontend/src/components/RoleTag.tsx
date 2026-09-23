import { Badge, Group } from '@mantine/core';
import type { RoomRole } from '../types/room';

interface RoleTagProps {
  role: RoomRole;
  isAdmin: boolean;
}

/** A member's role badge (Master or Player), plus an Admin badge for an Administrator. */
export function RoleTag({ role, isAdmin }: RoleTagProps) {
  return (
    <Group gap={4}>
      <Badge color={role === 'master' ? 'accent' : 'gray'} variant="light">
        {role === 'master' ? 'Master' : 'Player'}
      </Badge>
      {isAdmin && (
        <Badge color="gray" variant="outline">
          Admin
        </Badge>
      )}
    </Group>
  );
}
