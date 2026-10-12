import { useState } from 'react';
import { Button, Checkbox, Drawer, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { filterDocumentsByTags } from '../../lib/documentFilters';
import { toMapDocument } from '../../lib/maps';
import type { Document } from '../../types/document';
import type { MapDocument } from '../../types/map';
import type { Tag } from '../../types/tag';
import { TagFilter } from '../TagFilter';

interface AddDocumentsPanelProps {
  opened: boolean;
  onClose: () => void;
  /** The Room's Documents the viewer sees. */
  documents: Document[];
  tags: Tag[];
  /** The Documents already on the map: shown greyed out (Decision 10). */
  onMapIds: Set<string>;
  onAdd: (documents: MapDocument[]) => void;
}

/**
 * Picks Documents to put on the map (spec 28 Decision 10): search by name,
 * filter by Tag, the ones already on the map greyed out, since a Document is
 * on a map at most once.
 */
export function AddDocumentsPanel({
  opened,
  onClose,
  documents,
  tags,
  onMapIds,
  onAdd,
}: AddDocumentsPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);

  const needle = query.trim().toLocaleLowerCase();
  const shown = filterDocumentsByTags(documents, tagIds)
    .filter((document) => document.name.toLocaleLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleClose = () => {
    setQuery('');
    setTagIds([]);
    setChosen([]);
    onClose();
  };

  const handleAdd = () => {
    onAdd(documents.filter((document) => chosen.includes(document.id)).map(toMapDocument));
    handleClose();
  };

  return (
    <Drawer
      opened={opened}
      onClose={handleClose}
      title={t('maps.addDocuments')}
      position="right"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="sm">
        <TextInput
          leftSection={<MagnifyingGlassIcon size={16} />}
          placeholder={t('maps.searchDocuments')}
          aria-label={t('maps.searchDocuments')}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          data-autofocus
        />
        {tags.length > 0 && <TagFilter tags={tags} value={tagIds} onChange={setTagIds} />}
        {shown.length === 0 && <Text c="dimmed">{t('common.noResults')}</Text>}
        {shown.map((document) => {
          const onMap = onMapIds.has(document.id);
          return (
            <Checkbox
              key={document.id}
              label={document.subtitle ? `${document.name} · ${document.subtitle}` : document.name}
              description={onMap ? t('maps.alreadyOnMap') : undefined}
              disabled={onMap}
              checked={onMap || chosen.includes(document.id)}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setChosen((current) =>
                  checked ? [...current, document.id] : current.filter((id) => id !== document.id),
                );
              }}
            />
          );
        })}
        <Button onClick={handleAdd} disabled={chosen.length === 0}>
          {t('maps.addChosen', { count: chosen.length })}
        </Button>
      </Stack>
    </Drawer>
  );
}
