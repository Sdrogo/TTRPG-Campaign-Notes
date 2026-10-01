import { useState } from 'react';
import { ActionIcon, Card, Group, Menu, Stack, Title, Text, Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { DotsThreeVerticalIcon, GearIcon, SignOutIcon, UserPlusIcon } from '@phosphor-icons/react';
import { RoleTag } from './RoleTag';
import { InviteModal } from './InviteModal';
import { LeaveRoomModal } from './LeaveRoomModal';
import type { MyRoom } from '../types/room';
import { useTranslation } from 'react-i18next';

interface RoomCardProps {
  myRoom: MyRoom;
  /** The signed-in user, who can leave the Room from the card's menu. */
  currentUserId: string;
}

/**
 * One of the user's Rooms, with their role. The whole card links to the Room's
 * Documents; an Administrator also gets the setup page (members, Main Tags)
 * and the invite button, and every member gets a menu with Leave (spec 15).
 * These sit above that link and so win over it.
 */
export function RoomCard({ myRoom, currentUserId }: RoomCardProps) {
  const { t } = useTranslation();
  const [inviteOpened, setInviteOpened] = useState(false);
  const [leaveOpened, setLeaveOpened] = useState(false);
  const { room, role, isAdmin } = myRoom;

  return (
    <Card withBorder padding="md" radius="md" pos="relative">
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
        <Group gap="xs" pos="relative" style={{ zIndex: 2 }}>
          {isAdmin && (
            <>
              <Button
                component={Link}
                to={`/rooms/${room.id}/setup`}
                variant="subtle"
                size="xs"
                leftSection={<GearIcon size={16} />}
              >
                {t('rooms.setup')}
              </Button>
              <Button
                variant="light"
                size="xs"
                leftSection={<UserPlusIcon size={16} />}
                onClick={() => setInviteOpened(true)}
              >
                {t('rooms.invite')}
              </Button>
            </>
          )}
          <Menu position="bottom-end" shadow="md">
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={t('rooms.actions', { name: room.name })}
              >
                <DotsThreeVerticalIcon size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                color="red"
                leftSection={<SignOutIcon size={16} />}
                onClick={() => setLeaveOpened(true)}
              >
                {t('common.leave')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      {/* Covers the card rather than wrapping it, like DocumentCard: the
          buttons above can't live inside an <a>. */}
      <Link
        className="room-card-link"
        to={`/rooms/${room.id}/documents`}
        aria-label={room.name}
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
      />
      <InviteModal
        opened={inviteOpened}
        onClose={() => setInviteOpened(false)}
        roomId={room.id}
      />
      <LeaveRoomModal
        opened={leaveOpened}
        onClose={() => setLeaveOpened(false)}
        roomId={room.id}
        roomName={room.name}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
      />
    </Card>
  );
}
