import { useState } from 'react';
import { Button, Checkbox, Group, Modal, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { MAX_NOTE_LENGTH, MAX_PLACE_NAME_LENGTH } from '../../lib/geoMaps';
import { toMapDocument } from '../../lib/maps';
import type { Document } from '../../types/document';
import type { GeoArea } from '../../types/geoMap';
import type { ColorMeanings, MapColor } from '../../types/map';
import { MapColorPicker } from './MapColorPicker';
import { PlaceDocumentSelect } from './PlaceDocumentSelect';

const NO_SIBLINGS = () => ({ count: 0, color: null });

interface AreaDialogProps {
  /** What the map's area colors mean (spec 77b Decision 6): the chosen one's meaning shows under the colors. */
  meanings?: ColorMeanings;
  area: GeoArea;
  /** Just drawn: cancelling drops it, and there is nothing to delete yet. */
  isNew: boolean;
  documents: Document[];
  takenDocumentIds: Set<string>;
  /** The Documents that already have areas, offered marked (spec 77). */
  onMapDocumentIds?: Set<string>;
  /**
   * A Document's other areas on the map: how many, and the color they share
   * (spec 77 Decision 4b), which this area takes when bound to it.
   */
  siblingsOf?: (documentId: string) => { count: number; color: MapColor | null };
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
 * the area's values. A Document's areas share one color: binding the area
 * to a Document that has others takes theirs, and a new color recolors them
 * all on save (spec 77 Decision 4b).
 */
export function AreaDialog({
  area,
  isNew,
  documents,
  takenDocumentIds,
  onMapDocumentIds,
  siblingsOf = NO_SIBLINGS,
  isMaster,
  meanings,
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
  const siblings = documentId ? siblingsOf(documentId) : { count: 0, color: null };

  const chooseDocument = (next: string | null) => {
    setDocumentId(next);
    const shared = next ? siblingsOf(next).color : null;
    if (shared) setColor(shared);
  };

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
            onMapDocumentIds={onMapDocumentIds}
            value={documentId}
            onChange={chooseDocument}
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
          <MapColorPicker value={color} onChange={setColor} meanings={meanings} />
          {meanings && (
            <Text size="sm" c="dimmed" mt={-4}>
              {meanings[color]
                ? t('maps.legend.colorMeans', { meaning: meanings[color] })
                : t('maps.legend.colorMeansNothing')}
            </Text>
          )}
          {siblings.count > 0 && (
            <Text size="xs" c="dimmed">
              {t('maps.geo.sharedColor', { number: siblings.count + 1 })}
            </Text>
          )}
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
              <Button variant="subtle" color="danger" onClick={onDelete}>
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
