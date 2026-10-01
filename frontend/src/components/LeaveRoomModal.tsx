import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useLeaveRoom } from '../hooks/useMembers';
import { notifyError, notifySuccess } from '../lib/notify';

interface LeaveRoomModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
  roomName: string;
  /** The signed-in user, whose Membership is removed. */
  currentUserId: string;
  /** Adds a line pointing an Administrator at the setup page to name a successor. */
  isAdmin: boolean;
}

/**
 * Confirms leaving a Room (UC-19, spec 15). The user's Documents, Comments and
 * Notes stay in the Room (D-15). The last-Master/last-Administrator rule is
 * the backend's alone: its `409` text is shown and the modal stays open.
 */
export function LeaveRoomModal({
  opened,
  onClose,
  roomId,
  roomName,
  currentUserId,
  isAdmin,
}: LeaveRoomModalProps) {
  const { t } = useTranslation();
  const leaveRoom = useLeaveRoom(roomId);

  const handleLeave = () => {
    leaveRoom.mutate(currentUserId, {
      onSuccess: () => {
        notifySuccess(t('rooms.leave.left', { name: roomName }));
        onClose();
      },
      onError: notifyError,
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('rooms.leave.confirmTitle', { name: roomName })}
      centered
    >
      <Stack gap="md">
        <Text size="sm">{t('rooms.leave.confirmBody')}</Text>
        {isAdmin && (
          <Text size="sm" c="dimmed">
            {t('rooms.leave.adminHint')}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button color="red" loading={leaveRoom.isPending} onClick={handleLeave}>
            {t('common.leave')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
