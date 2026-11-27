import { Select } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { Document } from '../../types/document';

/**
 * Binds an area or pin to one of the Room's Documents, or to none (spec 38
 * Decisions 3-4). `takenDocumentIds` are not offered: for an area the
 * Documents placed as a pin, for a pin every Document already on the map
 * (spec 77 Decisions 1-2). `onMapDocumentIds` are offered marked "already
 * on the map": a Document that has areas may get one more.
 */
export function PlaceDocumentSelect({
  documents,
  takenDocumentIds,
  onMapDocumentIds,
  value,
  onChange,
}: {
  documents: Document[];
  takenDocumentIds: Set<string>;
  onMapDocumentIds?: Set<string>;
  value: string | null;
  onChange: (documentId: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      label={t('maps.geo.document')}
      description={t('maps.geo.documentHelp')}
      placeholder={t('maps.geo.noDocument')}
      searchable
      clearable
      clearButtonProps={{ 'aria-label': t('maps.geo.clearDocument') }}
      value={value}
      onChange={onChange}
      data={documents
        .filter((document) => document.id === value || !takenDocumentIds.has(document.id))
        .map((document) => ({
          value: document.id,
          label:
            document.id !== value && onMapDocumentIds?.has(document.id)
              ? t('maps.geo.alreadyOnMap', { name: document.name })
              : document.name,
        }))}
      nothingFoundMessage={t('maps.geo.noDocumentFound')}
      comboboxProps={{ withinPortal: true }}
    />
  );
}
