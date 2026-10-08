import { useState } from 'react';
import { Button, Group, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useExportDocument } from '../hooks/useRoomExport';
import { notifyError, notifySuccess } from '../lib/notify';
import { EXPORT_FORMATS, type ExportFormat } from '../lib/roomExport';

interface ExportDocumentModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
  documentId: string;
  documentName: string;
}

/**
 * The single-Document export dialog (spec 27 Decisions 1 to 4): JSON for tools
 * and for importing it again, or Markdown for reading, then a download of what
 * the signed-in user sees of it (or the member being previewed, spec 22b). The
 * file is the Room export with this Document alone. The backend decides what
 * goes in; nothing is filtered here.
 */
export function ExportDocumentModal({
  opened,
  onClose,
  roomId,
  documentId,
  documentName,
}: ExportDocumentModalProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ExportFormat>('md');
  const exportDocument = useExportDocument(roomId, documentId, documentName);

  const handleExport = () =>
    exportDocument.mutate(format, {
      onSuccess: () => {
        notifySuccess(t('export.done'));
        onClose();
      },
      onError: notifyError,
    });

  return (
    <Modal opened={opened} onClose={onClose} title={t('export.document.title')} centered>
      <Stack gap="md">
        <Text size="sm">{t('export.document.intro')}</Text>
        <SegmentedControl
          fullWidth
          aria-label={t('export.format')}
          value={format}
          onChange={(value) => setFormat(value as ExportFormat)}
          data={EXPORT_FORMATS.map((value) => ({ value, label: t(`export.formats.${value}`) }))}
        />
        <Text size="xs" c="dimmed">
          {t(`export.formatHint.${format}`)}
        </Text>
        <Text size="xs" c="dimmed">
          {t('export.linksExpire')}
        </Text>
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            leftSection={<DownloadSimpleIcon size={16} />}
            loading={exportDocument.isPending}
            onClick={handleExport}
          >
            {t('export.action')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
