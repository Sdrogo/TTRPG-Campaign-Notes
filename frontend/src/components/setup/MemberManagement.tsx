import { Table, Select, Switch, Button, Badge, Group, Stack, Text } from '@mantine/core';
import { UserPlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useUpdateMember, useRemoveMember } from '../../hooks/useMembers';
import { useFriends, useSendFriendRequest } from '../../hooks/useFriends';
import { friendStatus } from '../../lib/friends';
import { memberDisplayName } from '../../lib/members';
import { notifyError, notifySuccess } from '../../lib/notify';
import { UserAvatar } from '../UserAvatar';
import type { Member } from '../../types/member';
import type { RoomRole } from '../../types/room';

interface MemberManagementProps {
  roomId: string;
  members: Member[];
  currentUserId: string;
  /** Called after the current user removed themselves from the Room. */
  onLeft: () => void;
}

/**
 * The Room setup's member table (UC-05, UC-19): an Administrator changes
 * roles and the Administrator flag, removes members or leaves. Only rendered
 * for an Administrator, so it offers every control; the backend still refuses
 * what would leave the Room without a Master or Administrator (D-16) and the
 * message reaches the user.
 *
 * Each other member also gets "Add as Friend" (FR-F1, spec 18_2), or where
 * the two already stand: Friends, request sent or received. Left out when
 * the Friends list can't be loaded.
 */
export function MemberManagement({
  roomId,
  members,
  currentUserId,
  onLeft,
}: MemberManagementProps) {
  const { t } = useTranslation();
  const updateMember = useUpdateMember(roomId);
  const removeMember = useRemoveMember(roomId);
  const friends = useFriends(true);
  const sendRequest = useSendFriendRequest();

  /** Asks a member to become Friends and confirms it. */
  const handleAddFriend = (member: Member) => {
    sendRequest.mutate(
      { userId: member.userId },
      {
        onSuccess: () =>
          notifySuccess(t('members.friendRequestSent', { name: memberDisplayName(member) })),
        onError: notifyError,
      },
    );
  };

  /** The member's Friend status or the button to ask them; nothing for oneself. */
  const friendControl = (member: Member) => {
    if (!friends.data || member.userId === currentUserId) {
      return null;
    }
    const status = friendStatus(friends.data, member.userId);
    if (status === 'none') {
      return (
        <Button
          size="compact-xs"
          variant="light"
          leftSection={<UserPlusIcon size={14} />}
          loading={sendRequest.isPending && sendRequest.variables?.userId === member.userId}
          onClick={() => handleAddFriend(member)}
          style={{ alignSelf: 'flex-start' }}
          mt={4}
        >
          {t('members.addFriend')}
        </Button>
      );
    }
    const labels = {
      friend: t('members.friend'),
      outgoing: t('members.requestSent'),
      incoming: t('members.requestReceived'),
    };
    return (
      <Badge size="xs" variant="light" color={status === 'friend' ? 'accent' : 'gray'} mt={4}>
        {labels[status]}
      </Badge>
    );
  };

  /** Removes a member; removing yourself also leaves the page. */
  const handleRemove = (userId: string) => {
    removeMember.mutate(userId, {
      onSuccess: () => {
        if (userId === currentUserId) {
          onLeft();
        }
      },
      onError: notifyError,
    });
  };

  return (
    <Table.ScrollContainer minWidth={560}>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('members.columnUser')}</Table.Th>
            <Table.Th>{t('members.columnRole')}</Table.Th>
            <Table.Th>{t('members.columnAdmin')}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            return (
              <Table.Tr key={member.userId}>
                <Table.Td>
                  <Group gap="sm" wrap="nowrap" align="flex-start">
                    <UserAvatar user={member} size="md" />
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <Text component="div" size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
                        {memberDisplayName(member)}
                        {isSelf && (
                          <Badge ml="xs" size="xs" variant="outline" color="gray">
                            {t('common.you')}
                          </Badge>
                        )}
                      </Text>
                      {member.pronouns && (
                        <Text size="xs" c="dimmed">
                          {member.pronouns}
                        </Text>
                      )}
                      {member.bio && (
                        <Text
                          size="xs"
                          c="dimmed"
                          lineClamp={2}
                          title={member.bio}
                          style={{ whiteSpace: 'pre-line' }}
                        >
                          {member.bio}
                        </Text>
                      )}
                      {friendControl(member)}
                    </Stack>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Select
                    data={[
                      { value: 'player', label: t('roles.player') },
                      { value: 'master', label: t('roles.master') },
                    ]}
                    value={member.role}
                    onChange={(value) =>
                      value &&
                      updateMember.mutate(
                        { userId: member.userId, role: value as RoomRole },
                        { onError: notifyError },
                      )
                    }
                    allowDeselect={false}
                    size="xs"
                    w={110}
                  />
                </Table.Td>
                <Table.Td>
                  <Switch
                    checked={member.isAdmin}
                    onChange={(event) =>
                      updateMember.mutate(
                        {
                          userId: member.userId,
                          isAdmin: event.currentTarget.checked,
                        },
                        { onError: notifyError },
                      )
                    }
                  />
                </Table.Td>
                <Table.Td>
                  <Button
                    color="red"
                    variant="subtle"
                    size="xs"
                    onClick={() => handleRemove(member.userId)}
                    loading={removeMember.isPending && removeMember.variables === member.userId}
                  >
                    {isSelf ? t('common.leave') : t('common.remove')}
                  </Button>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
