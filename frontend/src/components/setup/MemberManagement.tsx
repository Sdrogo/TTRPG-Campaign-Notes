import { Table, Select, Switch, Button, Badge, Group, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useUpdateMember, useRemoveMember } from '../../hooks/useMembers';
import { memberDisplayName } from '../../lib/members';
import { notifyError } from '../../lib/notify';
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
                    loading={removeMember.isPending}
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
