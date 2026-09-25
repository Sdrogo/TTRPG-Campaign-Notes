import { useNavigate, useParams } from 'react-router-dom';
import { Title, Table, Select, Switch, Button, Text, Loader, Badge, Group, Stack } from '@mantine/core';
import { useSession } from '../hooks/useSession';
import { useMembers, useUpdateMember, useRemoveMember } from '../hooks/useMembers';
import { memberDisplayName } from '../lib/members';
import { notifyError } from '../lib/notify';
import { FullPageLoader, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { UserAvatar } from '../components/UserAvatar';
import type { RoomRole } from '../types/room';
import { useTranslation } from 'react-i18next';

/**
 * `/rooms/:roomId/members`: the Room's members. An Administrator changes roles
 * and the Administrator flag and removes members; anyone can leave.
 */
export function RoomMembersPage() {
  const { t } = useTranslation();
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { session, loading: sessionLoading } = useSession();
  const members = useMembers(roomId ?? '', Boolean(session) && Boolean(roomId));
  const updateMember = useUpdateMember(roomId ?? '');
  const removeMember = useRemoveMember(roomId ?? '');

  if (!roomId) {
    return null;
  }

  if (sessionLoading) {
    return <FullPageLoader />;
  }

  if (!session) {
    return <SignInRequired>{t('members.signInRequired')}</SignInRequired>;
  }

  const currentUserId = session.user.id;
  const currentMember = members.data?.find((m) => m.userId === currentUserId);
  const isAdmin = currentMember?.isAdmin ?? false;

  const handleRoleChange = (userId: string, role: RoomRole) => {
    updateMember.mutate({ userId, role }, { onError: notifyError });
  };

  const handleAdminToggle = (userId: string, nextIsAdmin: boolean) => {
    updateMember.mutate({ userId, isAdmin: nextIsAdmin }, { onError: notifyError });
  };

  const handleRemove = (userId: string) => {
    removeMember.mutate(userId, {
      onSuccess: () => {
        if (userId === currentUserId) {
          navigate('/');
        }
      },
      onError: notifyError,
    });
  };

  return (
    <PageLayout backTo="/" backLabel={t('common.myRooms')}>
      <Title order={2} style={{ fontFamily: 'var(--font-display)' }}>
        {t('members.title')}
      </Title>

      {members.isLoading && <Loader color="accent" />}
      {members.isError && <Text c="red">{t('members.loadError')}</Text>}

      {members.data && (
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
              {members.data.map((member) => {
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
                      {isAdmin ? (
                        <Select
                          data={[
                            { value: 'player', label: t('roles.player') },
                            { value: 'master', label: t('roles.master') },
                          ]}
                          value={member.role}
                          onChange={(value) =>
                            value && handleRoleChange(member.userId, value as RoomRole)
                          }
                          allowDeselect={false}
                          size="xs"
                          w={110}
                        />
                      ) : (
                        t(`roles.${member.role}`)
                      )}
                    </Table.Td>
                    <Table.Td>
                      {isAdmin ? (
                        <Switch
                          checked={member.isAdmin}
                          onChange={(event) =>
                            handleAdminToggle(member.userId, event.currentTarget.checked)
                          }
                        />
                      ) : member.isAdmin ? (
                        t('common.yes')
                      ) : (
                        t('common.notApplicable')
                      )}
                    </Table.Td>
                    <Table.Td>
                      {(isAdmin || isSelf) && (
                        <Button
                          color="red"
                          variant="subtle"
                          size="xs"
                          onClick={() => handleRemove(member.userId)}
                          loading={removeMember.isPending}
                        >
                          {isSelf ? t('common.leave') : t('common.remove')}
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </PageLayout>
  );
}
