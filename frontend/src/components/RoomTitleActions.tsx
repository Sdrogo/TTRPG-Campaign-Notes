import { useState } from 'react';
import { ActionIcon, Group, Menu, Tooltip } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import {
  DotsThreeVerticalIcon,
  EyeIcon,
  GearIcon,
  SignOutIcon,
  UserPlusIcon,
} from '@phosphor-icons/react';
import { memberDisplayName } from '../lib/members';
import { VIEW_AS_PARAM } from '../lib/viewAs';
import type { Member } from '../types/member';
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
  /**
   * For the Master: the members they can preview the Room as (spec 22b),
   * offered under "View as". Absent for everyone else.
   */
  viewAsMembers?: Member[];
}

/**
 * The Room card's actions (setup and invite for an Administrator, setup and
 * "View as" a member (spec 22b) for the Master, leave for everyone) beside the Room's title, folded into a "⋮" that unfolds them in
 * place when clicked (Andrea, 2026-10-03).
 */
export function RoomTitleActions({
  roomId,
  roomName,
  isAdmin,
  isMaster = false,
  currentUserId,
  onLeft,
  viewAsMembers,
}: RoomTitleActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [inviteOpened, setInviteOpened] = useState(false);
  const [leaveOpened, setLeaveOpened] = useState(false);

  return (
    <Group gap={4} wrap="nowrap">
      {expanded && (
        <>
          {viewAsMembers && viewAsMembers.length > 0 && (
            <Menu position="bottom-end" shadow="md">
              <Menu.Target>
                <Tooltip label={t('viewAs.action')} withArrow>
                  <ActionIcon variant="subtle" color="gray" size="lg" aria-label={t('viewAs.action')}>
                    <EyeIcon size={20} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{t('viewAs.menuLabel')}</Menu.Label>
                {viewAsMembers.map((member) => (
                  <Menu.Item
                    key={member.userId}
                    onClick={() => void navigate({ search: `?${VIEW_AS_PARAM}=${member.userId}` })}
                  >
                    {memberDisplayName(member)}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
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
