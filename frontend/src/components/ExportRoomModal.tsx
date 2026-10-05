import { useState } from 'react';
import { Button, Group, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useExportRoom } from '../hooks/useRoomExport';
import { useRoom } from '../hooks/useRooms';
import { useTags } from '../hooks/useTags';
import { notifyError, notifySuccess } from '../lib/notify';
import { EXPORT_FORMATS, type ExportFormat } from '../lib/roomExport';
import { TagFilter } from './TagFilter';

interface ExportRoomModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
}

/**
 * The Room export dialog (spec 23 Decision 5): a format (Markdown for people,
 * JSON for tools and Agents), optionally only the Documents carrying chosen
 * Tags, then a download of what the signed-in user sees. While the Master
 * previews the Room as a member (spec 22b) it exports that member's view. The
 * backend decides what goes in; nothing is filtered here.
 */
export function ExportRoomModal({ opened, onClose, roomId }: ExportRoomModalProps) {
  const { t } = useTranslation();
  const room = useRoom(roomId, opened);
  const tags = useTags(roomId, opened);
  const [format, setFormat] = useState<ExportFormat>('md');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const exportRoom = useExportRoom(roomId, room.data?.name ?? '');

  const handleExport = () => {
    exportRoom.mutate(
      { format, tagIds },
      {
        onSuccess: () => {
          notifySuccess(t('export.done'));
          onClose();
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t('export.title')} centered>
      <Stack gap="md">
        <Text size="sm">{t('export.intro')}</Text>
        <SegmentedControl
          fullWidth
          aria-label={t('export.format')}
          value={format}
          onChange={(value) => setFormat(value as ExportFormat)}
          data={EXPORT_FORMATS.map((value) => ({
            value,
            label: t(`export.formats.${value}`),
          }))}
        />
        <Text size="xs" c="dimmed">
          {t(`export.formatHint.${format}`)}
        </Text>
        <TagFilter
          tags={tags.data ?? []}
          value={tagIds}
          onChange={setTagIds}
          aria-label={t('export.tagFilter')}
          placeholder={tagIds.length === 0 ? t('export.tagFilter') : undefined}
        />
        <Text size="xs" c="dimmed">
          {t('export.linksExpire')}
        </Text>
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            leftSection={<DownloadSimpleIcon size={16} />}
            loading={exportRoom.isPending}
            disabled={!room.data}
            onClick={handleExport}
          >
            {t('export.action')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
