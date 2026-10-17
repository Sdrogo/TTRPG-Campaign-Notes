import { useState } from 'react';
import { Button, Checkbox, Group, Input, Modal, SegmentedControl, Stack, Textarea, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { MAX_NOTE_LENGTH, MAX_PLACE_NAME_LENGTH } from '../../lib/geoMaps';
import { toMapDocument } from '../../lib/maps';
import type { Document } from '../../types/document';
import type { GeoPin, LabelSide } from '../../types/geoMap';
import { MapColorPicker } from './MapColorPicker';
import { PlaceDocumentSelect } from './PlaceDocumentSelect';

interface PinDialogProps {
  pin: GeoPin;
  /** Just placed: cancelling drops it, and there is nothing to delete yet. */
  isNew: boolean;
  documents: Document[];
  takenDocumentIds: Set<string>;
  /** Only the Master marks a plain pin Master only. */
  isMaster: boolean;
  onSave: (pin: GeoPin) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Edits a pin (spec 38 Decision 4): bound to a Document (a diamond) or plain
 * with its own name and note (a circle); which side its name is written on,
 * and its color. Mounted per pin, so it starts from the pin's values.
 */
export function PinDialog({ pin, isNew, documents, takenDocumentIds, isMaster, onSave, onDelete, onClose }: PinDialogProps) {
  const { t } = useTranslation();
  const [documentId, setDocumentId] = useState(pin.documentId);
  const [name, setName] = useState(pin.name ?? '');
  const [note, setNote] = useState(pin.note ?? '');
  const [labelSide, setLabelSide] = useState<LabelSide>(pin.labelSide);
  const [color, setColor] = useState(pin.color);
  const [masterOnly, setMasterOnly] = useState(pin.masterOnly);
  const plain = documentId === null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const document = documents.find((candidate) => candidate.id === documentId);
    onSave({
      ...pin,
      documentId,
      name: plain ? name.trim() : null,
      note: plain ? note.trim() || null : null,
      labelSide,
      color,
      masterOnly: plain && masterOnly,
      document: document ? toMapDocument(document) : plain ? null : pin.document,
    });
  };

  return (
    <Modal opened onClose={onClose} title={isNew ? t('maps.geo.newPin') : t('maps.geo.editPin')} centered>
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
          <Input.Wrapper label={t('maps.geo.labelSide')}>
            <SegmentedControl
              fullWidth
              mt={4}
              value={labelSide}
              onChange={(value) => setLabelSide(value as LabelSide)}
              data={[
                { value: 'left', label: t('maps.geo.sides.left') },
                { value: 'right', label: t('maps.geo.sides.right') },
                { value: 'above', label: t('maps.geo.sides.above') },
                { value: 'below', label: t('maps.geo.sides.below') },
              ]}
            />
          </Input.Wrapper>
          <MapColorPicker value={color} onChange={setColor} />
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
                {t('maps.geo.deletePin')}
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
