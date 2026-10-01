import { useState } from 'react';
import { ActionIcon, Button, FileButton, Group, Modal, Stack, Text, Tooltip } from '@mantine/core';
import {
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  FilePdfIcon,
  TrashIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import { useDeleteDocumentFile, useUploadDocumentFile } from '../../hooks/useDocumentFiles';
import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_DOCUMENT,
  formatFileSize,
  openPdf,
  pdfProblem,
} from '../../lib/documentFiles';
import { notifyError } from '../../lib/notify';
import { formatAbsoluteTime } from '../../lib/time';
import type { DocumentFile } from '../../types/documentFile';
import { useTranslation } from 'react-i18next';

interface DocumentFileListProps {
  roomId: string;
  documentId: string;
  /** Exactly what the backend returned for the Document (VR-12). */
  files: DocumentFile[];
  /** Whether the viewer may attach a PDF: an Owner or the Master (D-22). */
  canUpload: boolean;
}

/**
 * A Document's PDF Attachments (spec 16): each opens in the browser's viewer
 * or downloads, and an Owner or the Master can upload or delete them. With no
 * files and no right to upload it renders nothing, so a reader's Document
 * looks as it did before files existed.
 */
export function DocumentFileList({ roomId, documentId, files, canUpload }: DocumentFileListProps) {
  const { t } = useTranslation();
  const upload = useUploadDocumentFile(roomId, documentId);
  const deleteFile = useDeleteDocumentFile(roomId, documentId);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DocumentFile | null>(null);

  if (files.length === 0 && !canUpload) {
    return null;
  }

  const full = files.length >= MAX_FILES_PER_DOCUMENT;

  const handlePick = (file: File | null) => {
    if (!file) return;
    const problem = pdfProblem(file);
    if (problem) {
      notifyError(t(problem, { mb: MAX_FILE_BYTES / (1024 * 1024) }));
      return;
    }
    upload.mutate(file, { onError: notifyError });
  };

  const handleOpen = (file: DocumentFile) => {
    setOpeningId(file.id);
    openPdf(file.url)
      .catch(() => notifyError(t('files.openFailed', { name: file.name })))
      .finally(() => setOpeningId(null));
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between" gap="xs">
        <Text fw={600} size="sm">
          {t('files.title')}
        </Text>
        {canUpload && (
          <FileButton onChange={handlePick} accept={ACCEPTED_FILE_TYPES} disabled={full}>
            {(props) => (
              <Tooltip
                label={full ? t('files.limitReached', { max: MAX_FILES_PER_DOCUMENT }) : t('files.uploadHint', { mb: MAX_FILE_BYTES / (1024 * 1024) })}
                withArrow
              >
                <Button
                  {...props}
                  variant="subtle"
                  color="gray"
                  size="xs"
                  disabled={full}
                  loading={upload.isPending}
                  leftSection={<UploadSimpleIcon size={14} />}
                >
                  {t('files.upload')}
                </Button>
              </Tooltip>
            )}
          </FileButton>
        )}
      </Group>

      {files.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t('files.empty')}
        </Text>
      ) : (
        <Stack gap={4} component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
          {files.map((file) => (
            <Group key={file.id} component="li" gap="xs" wrap="nowrap" justify="space-between">
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <FilePdfIcon size={20} style={{ flexShrink: 0 }} aria-hidden />
                <Stack gap={0} style={{ minWidth: 0 }}>
                  <Text size="sm" truncate="end" title={file.name}>
                    {file.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t('files.details', {
                      size: formatFileSize(file.sizeBytes),
                      date: formatAbsoluteTime(file.createdAt),
                    })}
                  </Text>
                </Stack>
              </Group>
              <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={() => handleOpen(file)}
                  loading={openingId === file.id}
                  aria-label={t('files.open', { name: file.name })}
                >
                  <ArrowSquareOutIcon size={16} />
                </ActionIcon>
                {/* The signed link is served as an attachment (D-22), so
                    following it downloads under the file's name. */}
                <ActionIcon
                  component="a"
                  href={file.url}
                  rel="noopener noreferrer"
                  variant="subtle"
                  color="gray"
                  aria-label={t('files.download', { name: file.name })}
                >
                  <DownloadSimpleIcon size={16} />
                </ActionIcon>
                {file.canDelete && (
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => setConfirmDelete(file)}
                    loading={deleteFile.isPending && deleteFile.variables === file.id}
                    aria-label={t('files.delete', { name: file.name })}
                  >
                    <TrashIcon size={16} />
                  </ActionIcon>
                )}
              </Group>
            </Group>
          ))}
        </Stack>
      )}

      {confirmDelete && (
        <Modal opened onClose={() => setConfirmDelete(null)} title={t('files.deleteConfirmTitle')} centered>
          <Stack gap="md">
            <Text size="sm">{t('files.deleteConfirmBody', { name: confirmDelete.name })}</Text>
            <Group justify="flex-end">
              <Button variant="subtle" color="gray" onClick={() => setConfirmDelete(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                color="red"
                onClick={() => {
                  deleteFile.mutate(confirmDelete.id, { onError: notifyError });
                  setConfirmDelete(null);
                }}
              >
                {t('common.delete')}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}
