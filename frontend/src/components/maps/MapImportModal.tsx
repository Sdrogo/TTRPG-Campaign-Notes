import { useState } from 'react';
import { Alert, Button, FileButton, Group, List, Modal, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { FileArrowUpIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useImportMap, usePreviewMapImport } from '../../hooks/useGeoMap';
import { readMapFile, type MapImportReport } from '../../lib/mapImport';
import type { GeoMapDetail } from '../../types/geoMap';
import type { DocumentVisibility } from '../../types/document';
import type { MapFormValues } from '../../types/map';
import type { Member } from '../../types/member';
import { MemberMultiSelect } from '../MemberMultiSelect';
import { VisibilitySelect } from '../VisibilitySelect';

/** The backend's limits on a map's name and description. */
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;

interface MapImportModalProps {
  roomId: string;
  members: Member[];
  /** The importer, who owns the new map and so isn't offered for a grant. */
  creatorId: string;
  defaultVisibility: DocumentVisibility;
  onImported: (map: GeoMapDetail) => void;
  onClose: () => void;
}

/** The names from the file that stay plain labels, under what happened to them. */
function NameList({ title, names }: { title: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <Stack gap={2}>
      <Text size="sm">{title}</Text>
      <List size="sm" withPadding>
        {names.map((name) => (
          <List.Item key={name}>{name}</List.Item>
        ))}
      </List>
    </Stack>
  );
}

/** What the import will create (Decision 10), before anything is. */
function ImportSummary({ report }: { report: MapImportReport }) {
  const { t } = useTranslation();
  return (
    <Stack gap="xs" role="status">
      <Text size="sm">
        {t('maps.import.counts', { areas: report.areas, pins: report.pins, links: report.links })}
      </Text>
      <Text size="sm" c="dimmed">
        {t('maps.import.plane', { width: report.planeWidth, height: report.planeHeight })} ·{' '}
        {t('maps.import.matched', { number: report.matched })}
      </Text>
      <NameList title={t('maps.import.notFound')} names={report.notFound} />
      <NameList title={t('maps.import.ambiguous')} names={report.ambiguous} />
      <NameList title={t('maps.import.repeated')} names={report.repeated} />
    </Stack>
  );
}

/**
 * Imports a geographic map from a JSON file (spec 38_3, Decision 10), such
 * as one Claude made in another chat: the file is read and checked first,
 * and the report says what the map will hold and which names matched no
 * Document; the new map takes its name, description and visibility from the
 * form. The background is uploaded afterwards on the new map.
 */
export function MapImportModal({
  roomId,
  members,
  creatorId,
  defaultVisibility,
  onImported,
  onClose,
}: MapImportModalProps) {
  const { t } = useTranslation();
  const preview = usePreviewMapImport(roomId);
  const importMap = useImportMap(roomId);
  const [fileName, setFileName] = useState<string | null>(null);
  const [map, setMap] = useState<Record<string, unknown> | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [values, setValues] = useState<MapFormValues>({
    name: '',
    description: '',
    visibility: defaultVisibility,
    selectiveUserIds: [],
  });
  const set = (patch: Partial<MapFormValues>) => setValues((current) => ({ ...current, ...patch }));

  const choose = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    setMap(null);
    setReadError(null);
    preview.reset();
    importMap.reset();
    const content = await readMapFile(file);
    if (!content) {
      setReadError(t('maps.import.notJson'));
      return;
    }
    preview.mutate(content, {
      onSuccess: (report) => {
        setMap(content);
        set({ name: report.name, description: report.description });
      },
    });
  };

  const report = map ? preview.data : undefined;
  const error = readError ?? preview.error?.message ?? importMap.error?.message ?? null;

  return (
    <Modal opened onClose={onClose} title={t('maps.import.title')} centered>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          // The button is off until the file has been read and checked.
          importMap.mutate({ map: map!, values }, { onSuccess: onImported });
        }}
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {t('maps.import.help')}
          </Text>
          <Group gap="sm" wrap="nowrap">
            <FileButton accept="application/json,.json" onChange={(file) => void choose(file)}>
              {(props) => (
                <Button
                  {...props}
                  variant="default"
                  leftSection={<FileArrowUpIcon size={16} />}
                  loading={preview.isPending}
                >
                  {t('maps.import.chooseFile')}
                </Button>
              )}
            </FileButton>
            <Text size="sm" c="dimmed" truncate>
              {fileName ?? t('maps.import.noFile')}
            </Text>
          </Group>
          {report && <ImportSummary report={report} />}
          {report && (
            <>
              <TextInput
                spellCheck
                label={t('common.name')}
                value={values.name}
                onChange={(event) => set({ name: event.currentTarget.value })}
                maxLength={MAX_NAME_LENGTH}
                required
              />
              <Textarea
                spellCheck
                label={t('common.description')}
                value={values.description}
                onChange={(event) => set({ description: event.currentTarget.value })}
                maxLength={MAX_DESCRIPTION_LENGTH}
                autosize
                minRows={2}
              />
              <VisibilitySelect
                label={t('visibility.label')}
                subject="comment"
                value={values.visibility}
                onChange={(visibility) => set({ visibility })}
              />
              {values.visibility === 'selective' && (
                <MemberMultiSelect
                  label={t('maps.selectiveLabel')}
                  members={members}
                  excludeUserIds={[creatorId]}
                  value={values.selectiveUserIds}
                  onChange={(selectiveUserIds) => set({ selectiveUserIds })}
                />
              )}
              <Text size="xs" c="dimmed">
                {t('maps.import.backgroundLater')}
              </Text>
            </>
          )}
          {error && <Alert color="red">{error}</Alert>}
          <Button type="submit" loading={importMap.isPending} disabled={!report || !values.name.trim()}>
            {t('maps.import.submit')}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
