import { useState } from 'react';
import { Alert, Button, FileInput, Group, Modal, Stack, Text } from '@mantine/core';
import { UploadSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { usePreviewImport, useImportJob, useStartImport } from '../../hooks/useDocumentImport';
import {
  IMPORT_ACCEPT,
  isActiveImportJob,
  type ImportPreview,
  type ImportResolution,
} from '../../lib/documentImport';
import { ImportExistingStep } from './ImportExistingStep';
import { ImportJobPanel } from './ImportJobPanel';
import { ImportReviewStep } from './ImportReviewStep';

interface ImportDocumentsModalProps {
  opened: boolean;
  onClose: () => void;
  roomId: string;
}

type Step = 'pick' | 'review' | 'existing' | 'job';

/**
 * The import dialog (spec 27 Frontend): pick the files, read the preview and
 * untick what is not wanted, choose Copy or Replace for the Documents that
 * already exist in the Room, then follow the background job to its result. Only
 * offered to members who may create Documents, and never while previewing as a
 * member; the backend checks both and decides every rule (what is dropped,
 * what may be replaced), the dialog only shows what it answers. Closing it
 * keeps a running import going; reopening shows it again.
 */
export function ImportDocumentsModal({ opened, onClose, roomId }: ImportDocumentsModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('pick');
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<Record<string, ImportResolution>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewImport = usePreviewImport(roomId);
  const startImport = useStartImport(roomId);
  const job = useImportJob(roomId, jobId);

  const reset = () => {
    setStep('pick');
    setFiles([]);
    setPreview(null);
    setSelected(new Set());
    setResolutions({});
    setJobId(null);
    setError(null);
  };

  const handleClose = () => {
    if (step !== 'job' || !isActiveImportJob(job.data)) {
      reset();
    }
    onClose();
  };

  const handlePreview = () => {
    setError(null);
    previewImport.mutate(files, {
      onSuccess: (found) => {
        setPreview(found);
        setSelected(new Set(found.documents.map((document) => document.key)));
        setResolutions({});
        setStep('review');
      },
      onError: (failure) => setError(failure.message),
    });
  };

  const ticked = preview?.documents.filter((document) => selected.has(document.key)) ?? [];
  const existing = ticked.filter((document) => document.existingDocumentId !== null);

  const handleStart = () => {
    setError(null);
    const replace = ticked
      .filter((document) => document.canReplace && resolutions[document.key] === 'replace')
      .map((document) => document.key);
    startImport.mutate(
      { files, selected: ticked.map((document) => document.key), replace },
      {
        onSuccess: (started) => {
          setJobId(started.id);
          setStep('job');
        },
        onError: (failure) => setError(failure.message),
      },
    );
  };

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const applyAll = (resolution: ImportResolution) =>
    setResolutions(
      Object.fromEntries(
        existing.map((document) => [
          document.key,
          resolution === 'replace' && document.canReplace ? 'replace' : 'copy',
        ]),
      ),
    );

  return (
    <Modal opened={opened} onClose={handleClose} title={t('documentImport.title')} centered size="lg">
      <Stack gap="md">
        {step === 'pick' && (
          <>
            <Text size="sm">{t('documentImport.intro')}</Text>
            <FileInput
              multiple
              clearable
              accept={IMPORT_ACCEPT}
              label={t('documentImport.files')}
              placeholder={t('documentImport.filesPlaceholder')}
              value={files}
              onChange={setFiles}
            />
            <Text size="xs" c="dimmed">
              {t('documentImport.jsonHint')}
            </Text>
          </>
        )}
        {step === 'review' && preview && (
          <ImportReviewStep preview={preview} selected={selected} onToggle={toggle} />
        )}
        {step === 'existing' && (
          <ImportExistingStep
            documents={existing}
            resolutions={resolutions}
            onChange={(key, resolution) =>
              setResolutions((current) => ({ ...current, [key]: resolution }))
            }
            onApplyAll={applyAll}
          />
        )}
        {step === 'job' && <ImportJobPanel roomId={roomId} job={job.data} onNew={reset} />}
        {error !== null && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {step === 'pick' && (
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button
              leftSection={<UploadSimpleIcon size={16} />}
              disabled={files.length === 0}
              loading={previewImport.isPending}
              onClick={handlePreview}
            >
              {t('documentImport.preview')}
            </Button>
          </Group>
        )}
        {step === 'review' && (
          <Group justify="space-between">
            <Button variant="subtle" color="gray" onClick={() => setStep('pick')}>
              {t('documentImport.back')}
            </Button>
            <Group gap="sm">
              <Text size="xs" c="dimmed">
                {t('documentImport.selectedCount', { count: ticked.length })}
              </Text>
              {existing.length > 0 ? (
                <Button onClick={() => setStep('existing')} disabled={ticked.length === 0}>
                  {t('documentImport.next')}
                </Button>
              ) : (
                <Button
                  onClick={handleStart}
                  disabled={ticked.length === 0}
                  loading={startImport.isPending}
                >
                  {t('documentImport.start')}
                </Button>
              )}
            </Group>
          </Group>
        )}
        {step === 'existing' && (
          <Group justify="space-between">
            <Button variant="subtle" color="gray" onClick={() => setStep('review')}>
              {t('documentImport.back')}
            </Button>
            <Button onClick={handleStart} loading={startImport.isPending}>
              {t('documentImport.start')}
            </Button>
          </Group>
        )}
        {step === 'job' && (
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={handleClose}>
              {t('common.close')}
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
