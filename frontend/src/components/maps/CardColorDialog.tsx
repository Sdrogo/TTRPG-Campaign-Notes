import { useState } from 'react';
import { Button, Group, Modal, Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { MapCard, MapColor } from '../../types/map';
import { MapColorPicker } from './MapColorPicker';

/**
 * Recolors a card of a mention map (spec 36 Decision 9): its place and color
 * are all a manager changes there, since its Documents and relations come
 * from the mentions. Mounted per card, so it starts from the card's color.
 */
export function CardColorDialog({
  card,
  onSave,
  onClose,
}: {
  card: MapCard;
  onSave: (color: MapColor) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [color, setColor] = useState(card.color);
  return (
    <Modal opened onClose={onClose} title={t('maps.card.editDocument', { name: card.document!.name })} centered>
      <Stack gap="sm">
        <MapColorPicker value={color} onChange={setColor} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onSave(color)}>{t('common.save')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
