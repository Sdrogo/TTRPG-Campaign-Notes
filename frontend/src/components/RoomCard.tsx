import { useState } from 'react';
import { ActionIcon, Box, Card, Group, Menu, Stack, Title, Text, Tooltip } from '@mantine/core';
import { Link } from 'react-router-dom';
import { DotsThreeVerticalIcon, GearIcon, SignOutIcon, UserPlusIcon } from '@phosphor-icons/react';
import { DocumentCardImages } from './DocumentCardImages';
import { RoleTag } from './RoleTag';
import { InviteModal } from './InviteModal';
import { LeaveRoomModal } from './LeaveRoomModal';
import type { MyRoom } from '../types/room';
import { useTranslation } from 'react-i18next';

// With an image the card grows so its right half reads as a picture, not a
// strip (as a DocumentCard does, though shorter: a Room card has less text).
const CARD_WITH_IMAGE_MIN_HEIGHT = { base: 160, sm: 180 };

interface RoomCardProps {
  myRoom: MyRoom;
  /** The signed-in user, who can leave the Room from the card's menu. */
  currentUserId: string;
}

/**
 * One of the user's Rooms, with their role. The whole card links to the Room's
 * Documents; an Administrator also gets the setup page (members, Main Tags)
 * and the invite button, the Master the setup page's visibility history
 * (spec 22), and every member gets a menu with Leave (spec 15).
 * These are icon buttons with tooltips, so they fit on the title row at any
 * card width, and sit above that link so they win over it. The Room's image
 * (spec 26) fills the card's right half like a DocumentCard's, fading into the
 * card, with the buttons on top of it.
 */
export function RoomCard({ myRoom, currentUserId }: RoomCardProps) {
  const { t } = useTranslation();
  const [inviteOpened, setInviteOpened] = useState(false);
  const [leaveOpened, setLeaveOpened] = useState(false);
  const { room, role, isAdmin } = myRoom;
  const imageUrl = room.imageUrl;

  return (
    <Card
      withBorder
      padding="md"
      radius="md"
      pos="relative"
      mih={imageUrl ? CARD_WITH_IMAGE_MIN_HEIGHT : undefined}
    >
      {imageUrl && (
        <Box pos="absolute" top={0} right={0} bottom={0} w="50%">
          <DocumentCardImages
            images={[{ id: room.id, url: imageUrl, isFavorite: true }]}
            documentName={room.name}
          />
        </Box>
      )}
      {/* nowrap: a long name or game system wraps inside its own column
          instead of pushing the actions onto a second row. */}
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack
          gap={4}
          // Above the image, which is positioned and would otherwise paint over it.
          pos="relative"
          w={imageUrl ? 'calc(50% - var(--mantine-spacing-sm))' : undefined}
          style={{ minWidth: 0 }}
        >
          <Title
            order={2}
            fz="h3"
            style={{ fontFamily: 'var(--font-display)', overflowWrap: 'anywhere' }}
          >
            {room.name}
          </Title>
          {room.gameSystem && (
            <Text c="dimmed" size="sm" style={{ overflowWrap: 'anywhere' }}>
              {room.gameSystem}
            </Text>
          )}
          <RoleTag role={role} isAdmin={isAdmin} />
        </Stack>
        <Group
          gap={4}
          wrap="nowrap"
          pos="relative"
          // On the image they get the page's background behind them, so they
          // stay readable on a light picture (like a DocumentCard's badges).
          bg={imageUrl ? 'var(--bg-base)' : undefined}
          p={imageUrl ? 2 : undefined}
          style={{ zIndex: 2, flexShrink: 0, borderRadius: 'var(--mantine-radius-md)' }}
        >
          {(isAdmin || role === 'master') && (
            <Tooltip label={t('rooms.setup')} withArrow>
              <ActionIcon
                component={Link}
                to={`/rooms/${room.id}/setup`}
                variant="subtle"
                color="gray"
                aria-label={t('rooms.setup')}
              >
                <GearIcon size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          {isAdmin && (
            <>
              <Tooltip label={t('rooms.invite')} withArrow>
                <ActionIcon
                  variant="light"
                  aria-label={t('rooms.invite')}
                  onClick={() => setInviteOpened(true)}
                >
                  <UserPlusIcon size={18} />
                </ActionIcon>
              </Tooltip>
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
