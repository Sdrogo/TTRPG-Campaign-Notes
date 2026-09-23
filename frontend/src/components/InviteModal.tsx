import { useState } from 'react';
import {
  Modal,
  Stack,
  Select,
  Button,
  TextInput,
  CopyButton,
  ActionIcon,
  Group,
  Text,
  Tooltip,
} from '@mantine/core';
import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { useCreateInvitation } from '../hooks/useRooms';
import type { RoomRole } from '../types/room';

interface InviteModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
}

/** Creates an invitation link for the Room with a proposed role, ready to copy and share. */
export function InviteModal({ opened, onClose, roomId }: InviteModalProps) {
  const [role, setRole] = useState<RoomRole>('player');
  const createInvitation = useCreateInvitation(roomId);

  const handleClose = () => {
    createInvitation.reset();
    onClose();
  };

  const inviteUrl = createInvitation.data
    ? `${window.location.origin}/invite/${createInvitation.data.code}`
    : null;

  return (
    <Modal opened={opened} onClose={handleClose} title="Invita nella Stanza" centered>
      <Stack gap="sm">
        <Select
          label="Ruolo proposto"
          data={[
            { value: 'player', label: 'Player' },
            { value: 'master', label: 'Master' },
          ]}
          value={role}
          onChange={(value) => setRole((value as RoomRole | null) ?? 'player')}
          disabled={Boolean(inviteUrl)}
          allowDeselect={false}
        />
        {!inviteUrl && (
          <Button onClick={() => createInvitation.mutate(role)} loading={createInvitation.isPending}>
            Genera invito
          </Button>
        )}
        {createInvitation.isError && (
          <Text c="red" size="sm">
            {String(createInvitation.error)}
          </Text>
        )}
        {inviteUrl && (
          <Group gap="xs" wrap="nowrap">
            <TextInput value={inviteUrl} readOnly style={{ flex: 1 }} />
            <CopyButton value={inviteUrl}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copiato' : 'Copia'}>
                  <ActionIcon variant="light" onClick={copy}>
                    {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
