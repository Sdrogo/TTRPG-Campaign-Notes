import { useState } from 'react';
import { Card, Group, Stack, Title, Text, Button } from '@mantine/core';
import { UserPlus } from '@phosphor-icons/react';
import { RoleTag } from './RoleTag';
import { InviteModal } from './InviteModal';
import type { MyRoom } from '../types/room';

interface RoomCardProps {
  myRoom: MyRoom;
}

export function RoomCard({ myRoom }: RoomCardProps) {
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
        {isAdmin && (
          <Button
            variant="light"
            size="xs"
            leftSection={<UserPlus size={16} />}
            onClick={() => setInviteOpened(true)}
          >
            Invita
          </Button>
        )}
      </Group>
      <InviteModal
        opened={inviteOpened}
        onClose={() => setInviteOpened(false)}
        roomId={room.id}
      />
    </Card>
  );
}
