import { useRef, useState } from 'react';
import { Alert, Button, FileInput, Group, Modal, Stack, Switch, Text } from '@mantine/core';
import { FolderOpenIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { usePreviewImport, useImportJob, useStartImport } from '../../hooks/useDocumentImport';
import {
  IMPORT_ACCEPT,
  isActiveImportJob,
  isPageCard,
  MAX_IMPORT_IMAGES,
  vaultNotes,
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
 * untick the Documents and maps (spec 40) that are not wanted, tick the
 * Sections of the Room home to bring and page cards to apply (spec 56), choose Copy or Replace for the Documents that
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
  // Spec 65: read the Markdown as Obsidian notes (the backend detects them otherwise).
  const [vault, setVault] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedMaps, setSelectedMaps] = useState<Set<string>>(new Set());
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<Record<string, ImportResolution>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewImport = usePreviewImport(roomId);
  const startImport = useStartImport(roomId);
  const job = useImportJob(roomId, jobId);

  const reset = () => {
    setStep('pick');
    setFiles([]);
    setVault(false);
    setPreview(null);
    setSelected(new Set());
    setSelectedMaps(new Set());
    setSelectedSections(new Set());
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
    previewImport.mutate(vault ? { files, obsidian: true } : files, {
      onSuccess: (found) => {
        setPreview(found);
        setSelected(new Set(found.documents.map((document) => document.key)));
        setSelectedMaps(
          new Set(found.maps.filter((map) => map.skipped === null).map((map) => map.key)),
        );
        // Custom Sections come ticked; a page card overwrites the Room's own, so only when ticked.
        setSelectedSections(
          new Set(
            found.sections
              .filter((section) => section.skipped === null && !isPageCard(section))
              .map((section) => section.key),
          ),
        );
        setResolutions({});
        setStep('review');
      },
      onError: (failure) => setError(failure.message),
    });
  };

  const ticked = preview?.documents.filter((document) => selected.has(document.key)) ?? [];
  const existing = ticked.filter((document) => document.existingDocumentId !== null);
  // Spec 59 Decision 1: the cap counts the ticked Documents' images only.
  const tickedImages = ticked.reduce((sum, document) => sum + document.imagesCount, 0);
  const overImages = tickedImages > MAX_IMPORT_IMAGES;
  const chosenSections =
    preview?.sections.filter((section) => selectedSections.has(section.key)) ?? [];

  const handleStart = () => {
    setError(null);
    const replace = ticked
      .filter((document) => document.canReplace && resolutions[document.key] === 'replace')
      .map((document) => document.key);
    startImport.mutate(
      {
        files,
        obsidian: vault ? true : undefined,
        selected: ticked.map((document) => document.key),
        replace,
        maps: [...selectedMaps],
        sections: chosenSections.filter((section) => !isPageCard(section)).map((s) => s.key),
        pageCards: chosenSections.filter(isPageCard).map((section) => section.key),
      },
      {
        onSuccess: (started) => {
          setJobId(started.id);
          setStep('job');
        },
        onError: (failure) => setError(failure.message),
      },
    );
  };

  const toggleIn = (setter: typeof setSelected) => (key: string) =>
    setter((current) => {
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
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t('documentImport.title')}
      centered
      size="lg"
    >
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
            <Group gap="sm" align="center">
              <Button
                variant="light"
                leftSection={<FolderOpenIcon size={18} />}
                onClick={() => folderInput.current?.click()}
              >
                {t('documentImport.folderButton')}
              </Button>
              <Switch
                checked={vault}
                onChange={(event) => setVault(event.currentTarget.checked)}
                label={t('documentImport.vaultLabel')}
              />
            </Group>
            <input
              ref={folderInput}
              type="file"
              hidden
              multiple
              // @ts-expect-error webkitdirectory is a non-standard attribute React passes through
              webkitdirectory=""
              data-testid="import-folder-input"
              onChange={(event) => {
                const picked = vaultNotes(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = '';
                if (picked.length > 0) {
                  setFiles(picked);
                  setVault(true);
                }
              }}
            />
            <Text size="xs" c="dimmed">
              {t('documentImport.vaultHint')}
            </Text>
            <Text size="xs" c="dimmed">
              {t('documentImport.jsonHint')}
            </Text>
          </>
        )}
        {step === 'review' && preview && (
          <ImportReviewStep
            preview={preview}
            selected={selected}
            onToggle={toggleIn(setSelected)}
            selectedMaps={selectedMaps}
            onToggleMap={toggleIn(setSelectedMaps)}
            selectedSections={selectedSections}
            onToggleSection={toggleIn(setSelectedSections)}
          />
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
          <Alert color="danger" role="alert">
            {error}
          </Alert>
        )}
        {step === 'pick' && (
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button
              leftSection={<UploadSimpleIcon size={18} />}
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
              <Text size="xs" c={overImages ? 'danger' : 'dimmed'}>
                {overImages
                  ? t('documentImport.tooManyImages', {
                      count: tickedImages,
                      max: MAX_IMPORT_IMAGES,
                    })
                  : t('documentImport.selectedCount', { count: ticked.length })}
              </Text>
              {existing.length > 0 ? (
                <Button
                  onClick={() => setStep('existing')}
                  disabled={ticked.length === 0 || overImages}
                >
                  {t('documentImport.next')}
                </Button>
              ) : (
                <Button
                  onClick={handleStart}
                  disabled={ticked.length === 0 || overImages}
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
