import { Select } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { Document } from '../../types/document';

/**
 * Binds an area or pin to one of the Room's Documents, or to none (spec 38
 * Decisions 3-4). A Document already on the map, as another area or pin, is
 * not offered: it appears at most once per map.
 */
export function PlaceDocumentSelect({
  documents,
  takenDocumentIds,
  value,
  onChange,
}: {
  documents: Document[];
  takenDocumentIds: Set<string>;
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
        .map((document) => ({ value: document.id, label: document.name }))}
      nothingFoundMessage={t('maps.geo.noDocumentFound')}
      comboboxProps={{ withinPortal: true }}
    />
  );
}
