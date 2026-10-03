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
 * A Document's PDF Attachments (spec 16), a section of the info panel: each
 * opens in the browser's viewer or downloads, and an Owner or the Master can
 * upload or delete them. With no
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
    <Stack gap={4}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="xs" c="dimmed">
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
                  size="compact-xs"
                  disabled={full}
                  loading={upload.isPending}
                  leftSection={<UploadSimpleIcon size={12} />}
                >
                  {t('files.upload')}
                </Button>
              </Tooltip>
            )}
          </FileButton>
        )}
      </Group>

      {/* With no files the row is just its title and the upload action: no
          "nothing here" line, which only added weight. */}
      {files.length > 0 && (
        <Stack gap={2} component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
          {files.map((file) => (
            <Group key={file.id} component="li" gap="xs" wrap="nowrap" justify="space-between">
              <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                <FilePdfIcon size={16} color="var(--accent-primary)" style={{ flexShrink: 0 }} aria-hidden />
                <Text size="sm" truncate="end" title={file.name}>
                  {file.name}
                </Text>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ flexShrink: 0 }}
                  title={formatAbsoluteTime(file.createdAt)}
                >
                  {formatFileSize(file.sizeBytes)}
                </Text>
              </Group>
              <Group gap={0} wrap="nowrap" style={{ flexShrink: 0 }}>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  onClick={() => handleOpen(file)}
                  loading={openingId === file.id}
                  aria-label={t('files.open', { name: file.name })}
                >
                  <ArrowSquareOutIcon size={14} />
                </ActionIcon>
                {/* The signed link is served as an attachment (D-22), so
                    following it downloads under the file's name. */}
                <ActionIcon
                  component="a"
                  href={file.url}
                  rel="noopener noreferrer"
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label={t('files.download', { name: file.name })}
                >
                  <DownloadSimpleIcon size={14} />
                </ActionIcon>
                {file.canDelete && (
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={() => setConfirmDelete(file)}
                    loading={deleteFile.isPending && deleteFile.variables === file.id}
                    aria-label={t('files.delete', { name: file.name })}
                  >
                    <TrashIcon size={14} />
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
