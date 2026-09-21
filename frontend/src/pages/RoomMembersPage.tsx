import { useNavigate, useParams, Link } from 'react-router-dom';
import { Stack, Group, Title, Table, Select, Switch, Button, Text, Loader, Badge } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { useSession } from '../hooks/useSession';
import { useMembers, useUpdateMember, useRemoveMember } from '../hooks/useMembers';
import type { RoomRole } from '../types/room';

export function RoomMembersPage() {
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
    return (
      <Stack align="center" justify="center" style={{ minHeight: '100svh' }}>
        <Loader color="accent" />
      </Stack>
    );
  }

  if (!session) {
    return (
      <Stack align="center" justify="center" gap="md" style={{ minHeight: '100svh' }}>
        <Text>Accedi per vedere i membri di questa Stanza.</Text>
        <Button component={Link} to="/">
          Vai al login
        </Button>
      </Stack>
    );
  }

  const currentUserId = session.user.id;
  const currentMember = members.data?.find((m) => m.userId === currentUserId);
  const isAdmin = currentMember?.isAdmin ?? false;

  const notifyError = (error: unknown) => {
    notifications.show({ color: 'red', message: error instanceof Error ? error.message : String(error) });
  };

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
    <Stack gap="md" p="md">
      <Group>
        <Button component={Link} to="/" variant="subtle" leftSection={<ArrowLeftIcon size={16} />}>
          Le mie Stanze
        </Button>
      </Group>
      <Title order={2} style={{ fontFamily: 'var(--font-display)' }}>
        Membri della Stanza
      </Title>

      {members.isLoading && <Loader color="accent" />}
      {members.isError && <Text c="red">Errore nel caricamento dei membri.</Text>}

      {members.data && (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Utente</Table.Th>
              <Table.Th>Ruolo</Table.Th>
              <Table.Th>Amministratore</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {members.data.map((member) => {
              const isSelf = member.userId === currentUserId;
              return (
                <Table.Tr key={member.userId}>
                  <Table.Td>
                    {member.email ?? member.userId}
                    {isSelf && (
                      <Badge ml="xs" size="xs" variant="outline" color="gray">
                        Tu
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {isAdmin ? (
                      <Select
                        data={[
                          { value: 'player', label: 'Player' },
                          { value: 'master', label: 'Master' },
                        ]}
                        value={member.role}
                        onChange={(value) =>
                          value && handleRoleChange(member.userId, value as RoomRole)
                        }
                        allowDeselect={false}
                        size="xs"
                        w={110}
                      />
                    ) : member.role === 'master' ? (
                      'Master'
                    ) : (
                      'Player'
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
                      'Sì'
                    ) : (
                      '—'
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
                        {isSelf ? 'Esci' : 'Rimuovi'}
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
