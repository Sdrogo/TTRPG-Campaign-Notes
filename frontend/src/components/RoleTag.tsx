import { Badge, Group } from '@mantine/core';
import type { RoomRole } from '../types/room';
import { useTranslation } from 'react-i18next';

interface RoleTagProps {
  role: RoomRole;
  isAdmin: boolean;
}

/** A member's role badge (Master or Player), plus an Admin badge for an Administrator. */
export function RoleTag({ role, isAdmin }: RoleTagProps) {
  const { t } = useTranslation();
  return (
    <Group gap={4}>
      <Badge color={role === 'master' ? 'accent' : 'gray'} variant="light">
        {t(`roles.${role}`)}
      </Badge>
      {isAdmin && (
        <Badge color="gray" variant="outline">
          {t('roles.admin')}
        </Badge>
      )}
    </Group>
  );
}
