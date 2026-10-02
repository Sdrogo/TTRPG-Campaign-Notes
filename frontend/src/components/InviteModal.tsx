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
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';
import { CheckIcon, CopyIcon, LinkIcon, UsersIcon } from '@phosphor-icons/react';
import { InviteFriendPanel } from './InviteFriendPanel';
import { useCreateInvitation } from '../hooks/useRooms';
import type { RoomRole } from '../types/room';
import { useTranslation } from 'react-i18next';

interface InviteModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
}

/**
 * Invites someone to the Room with a proposed role: the "Link" tab creates an
 * invitation link to copy and share, the "Friends" tab sends the invitation
 * straight to a Friend (FR-F5, spec 18_2).
 */
export function InviteModal({ opened, onClose, roomId }: InviteModalProps) {
  const { t } = useTranslation();
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
    <Modal opened={opened} onClose={handleClose} title={t('invite.modalTitle')} centered>
      <Tabs defaultValue="link" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="link" leftSection={<LinkIcon size={16} />}>
            {t('invite.tabLink')}
          </Tabs.Tab>
          <Tabs.Tab value="friends" leftSection={<UsersIcon size={16} />}>
            {t('invite.tabFriends')}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="link">
          <Stack gap="sm">
            <Select
              label={t('invite.proposedRole')}
              data={[
                { value: 'player', label: t('roles.player') },
                { value: 'master', label: t('roles.master') },
              ]}
              value={role}
              onChange={(value) => value && setRole(value as RoomRole)}
              disabled={Boolean(inviteUrl)}
              allowDeselect={false}
            />
            {!inviteUrl && (
              <Button onClick={() => createInvitation.mutate(role)} loading={createInvitation.isPending}>
                {t('invite.generate')}
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
                    <Tooltip label={copied ? t('common.copied') : t('common.copy')}>
                      <ActionIcon
                        variant="light"
                        onClick={copy}
                        aria-label={copied ? t('common.copied') : t('common.copy')}
                      >
                        {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>
            )}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="friends">
          <InviteFriendPanel roomId={roomId} />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
