import { useState } from 'react';
import { Button, Checkbox, Group, Modal, Stack, Textarea, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { MAX_NOTE_LENGTH, MAX_PLACE_NAME_LENGTH } from '../../lib/geoMaps';
import { toMapDocument } from '../../lib/maps';
import type { Document } from '../../types/document';
import type { GeoArea } from '../../types/geoMap';
import { MapColorPicker } from './MapColorPicker';
import { PlaceDocumentSelect } from './PlaceDocumentSelect';

interface AreaDialogProps {
  area: GeoArea;
  /** Just drawn: cancelling drops it, and there is nothing to delete yet. */
  isNew: boolean;
  documents: Document[];
  takenDocumentIds: Set<string>;
  /** Only the Master marks a plain area Master only. */
  isMaster: boolean;
  onSave: (area: GeoArea) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Edits an area (spec 38 Decision 3): bound to a Document, whose name and
 * subtitle it then shows, or plain, with its own name, subtitle and note;
 * its color, fill and dashed outline. Mounted per area, so it starts from
 * the area's values.
 */
export function AreaDialog({
  area,
  isNew,
  documents,
  takenDocumentIds,
  isMaster,
  onSave,
  onDelete,
  onClose,
}: AreaDialogProps) {
  const { t } = useTranslation();
  const [documentId, setDocumentId] = useState(area.documentId);
  const [name, setName] = useState(area.name ?? '');
  const [subtitle, setSubtitle] = useState(area.subtitle ?? '');
  const [note, setNote] = useState(area.note ?? '');
  const [color, setColor] = useState(area.color);
  const [filled, setFilled] = useState(area.filled);
  const [dashed, setDashed] = useState(area.dashed);
  const [masterOnly, setMasterOnly] = useState(area.masterOnly);
  const plain = documentId === null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const document = documents.find((candidate) => candidate.id === documentId);
    onSave({
      ...area,
      documentId,
      name: plain ? name.trim() : null,
      subtitle: plain ? subtitle.trim() || null : null,
      note: plain ? note.trim() || null : null,
      color,
      filled,
      dashed,
      masterOnly: plain && masterOnly,
      document: document ? toMapDocument(document) : plain ? null : area.document,
    });
  };

  return (
    <Modal opened onClose={onClose} title={isNew ? t('maps.geo.newArea') : t('maps.geo.editArea')} centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <PlaceDocumentSelect
            documents={documents}
            takenDocumentIds={takenDocumentIds}
            value={documentId}
            onChange={setDocumentId}
          />
          {plain && (
            <>
              <TextInput
                spellCheck
                label={t('maps.geo.placeName')}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                maxLength={MAX_PLACE_NAME_LENGTH}
                required
                data-autofocus
              />
              <TextInput
                spellCheck
                label={t('maps.geo.subtitle')}
                value={subtitle}
                onChange={(event) => setSubtitle(event.currentTarget.value)}
                maxLength={MAX_PLACE_NAME_LENGTH}
              />
              <Textarea
                spellCheck
                label={t('maps.geo.note')}
                value={note}
                onChange={(event) => setNote(event.currentTarget.value)}
                maxLength={MAX_NOTE_LENGTH}
                autosize
                minRows={2}
              />
            </>
          )}
          <MapColorPicker value={color} onChange={setColor} />
          <Checkbox label={t('maps.geo.filled')} checked={filled} onChange={(event) => setFilled(event.currentTarget.checked)} />
          <Checkbox label={t('maps.geo.dashed')} checked={dashed} onChange={(event) => setDashed(event.currentTarget.checked)} />
          {isMaster && plain && (
            <Checkbox
              label={t('maps.geo.masterOnly')}
              checked={masterOnly}
              onChange={(event) => setMasterOnly(event.currentTarget.checked)}
            />
          )}
          <Group justify={isNew ? 'flex-end' : 'space-between'}>
            {!isNew && (
              <Button variant="subtle" color="red" onClick={onDelete}>
                {t('maps.geo.deleteArea')}
              </Button>
            )}
            <Button type="submit" disabled={plain && !name.trim()}>
              {t('common.save')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
