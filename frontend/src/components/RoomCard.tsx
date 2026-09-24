import { useState } from 'react';
import { Card, Group, Stack, Title, Text, Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { FilesIcon, UserPlusIcon, UsersIcon } from '@phosphor-icons/react';
import { RoleTag } from './RoleTag';
import { InviteModal } from './InviteModal';
import type { MyRoom } from '../types/room';
import { useTranslation } from 'react-i18next';

interface RoomCardProps {
  myRoom: MyRoom;
}

/**
 * One of the user's Rooms, with their role and links to its Documents and
 * members. An Administrator also gets the invite button.
 */
export function RoomCard({ myRoom }: RoomCardProps) {
  const { t } = useTranslation();
  const [inviteOpened, setInviteOpened] = useState(false);
  const { room, role, isAdmin } = myRoom;

  return (
    <Card withBorder padding="md" radius="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title order={3} style={{ fontFamily: 'var(--font-display)' }}>
            {room.name}
          </Title>
          {room.gameSystem && (
            <Text c="dimmed" size="sm">
              {room.gameSystem}
            </Text>
          )}
          <RoleTag role={role} isAdmin={isAdmin} />
        </Stack>
        <Group gap="xs">
          <Button
            component={Link}
            to={`/rooms/${room.id}/documents`}
            variant="subtle"
            size="xs"
            leftSection={<FilesIcon size={16} />}
          >
            {t('rooms.documents')}
          </Button>
          <Button
            component={Link}
            to={`/rooms/${room.id}/members`}
            variant="subtle"
            size="xs"
            leftSection={<UsersIcon size={16} />}
          >
            {t('rooms.members')}
          </Button>
          {isAdmin && (
            <Button
              variant="light"
              size="xs"
              leftSection={<UserPlusIcon size={16} />}
              onClick={() => setInviteOpened(true)}
            >
              {t('rooms.invite')}
            </Button>
          )}
        </Group>
      </Group>
      <InviteModal
        opened={inviteOpened}
        onClose={() => setInviteOpened(false)}
        roomId={room.id}
      />
    </Card>
  );
}
