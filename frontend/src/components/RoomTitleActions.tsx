import { useState } from 'react';
import { ActionIcon, Group, Tooltip } from '@mantine/core';
import { Link } from 'react-router-dom';
import { DotsThreeVerticalIcon, GearIcon, SignOutIcon, UserPlusIcon } from '@phosphor-icons/react';
import { InviteModal } from './InviteModal';
import { LeaveRoomModal } from './LeaveRoomModal';
import { useTranslation } from 'react-i18next';

interface RoomTitleActionsProps {
  roomId: string;
  roomName: string;
  /** Shows the setup and invite buttons, like on the Room's card. */
  isAdmin: boolean;
  /** Shows the setup button too: a Master reads the visibility history there (spec 22). */
  isMaster?: boolean;
  /** The signed-in user, who can leave the Room. */
  currentUserId: string;
  /** Called once the user has left, to take them off the Room's pages. */
  onLeft: () => void;
}

/**
 * The Room card's actions (setup and invite for an Administrator, setup for
 * the Master too, leave for everyone) beside the Room's title, folded into a "⋮" that unfolds them in
 * place when clicked (Andrea, 2026-10-03).
 */
export function RoomTitleActions({
  roomId,
  roomName,
  isAdmin,
  isMaster = false,
  currentUserId,
  onLeft,
}: RoomTitleActionsProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [inviteOpened, setInviteOpened] = useState(false);
  const [leaveOpened, setLeaveOpened] = useState(false);

  return (
    <Group gap={4} wrap="nowrap">
      {expanded && (
        <>
          {(isAdmin || isMaster) && (
            <Tooltip label={t('rooms.setup')} withArrow>
              <ActionIcon
                component={Link}
                to={`/rooms/${roomId}/setup`}
                variant="subtle"
                color="gray"
                size="lg"
                aria-label={t('rooms.setup')}
              >
                <GearIcon size={20} />
              </ActionIcon>
            </Tooltip>
          )}
          {isAdmin && (
            <>
              <Tooltip label={t('rooms.invite')} withArrow>
                <ActionIcon
                  variant="light"
                  size="lg"
                  aria-label={t('rooms.invite')}
                  onClick={() => setInviteOpened(true)}
                >
                  <UserPlusIcon size={20} />
                </ActionIcon>
              </Tooltip>
            </>
          )}
          <Tooltip label={t('common.leave')} withArrow>
            <ActionIcon
              variant="subtle"
              color="red"
              size="lg"
              aria-label={t('common.leave')}
              onClick={() => setLeaveOpened(true)}
            >
              <SignOutIcon size={20} />
            </ActionIcon>
          </Tooltip>
        </>
      )}
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        aria-label={t('rooms.actions', { name: roomName })}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <DotsThreeVerticalIcon size={20} />
      </ActionIcon>
      {isAdmin && (
        <InviteModal opened={inviteOpened} onClose={() => setInviteOpened(false)} roomId={roomId} />
      )}
      <LeaveRoomModal
        opened={leaveOpened}
        onClose={() => setLeaveOpened(false)}
        onLeft={onLeft}
        roomId={roomId}
        roomName={roomName}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
      />
    </Group>
  );
}
